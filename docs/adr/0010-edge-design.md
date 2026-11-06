---
status: accepted
---

# Edge design: Cilium Gateway over plain HTTP, shared secret checked by an nginx sidecar in the `api` pod

The phone reaches one Cilium Gateway (Gateway API, ADR 0001) on a LoadBalancer IP from the L2 pool. The Gateway routes `/api/*` to `api` and everything else to `web`. In v1 it serves plain HTTP on `:80`: no domain, no certificates. The shared secret is checked by a small nginx sidecar container inside the `api` pod, not by the Gateway and not by `api` itself ([Edge design](https://github.com/bhh1893/health-tracker/issues/11)). This amends [HTTPS on the home network](https://github.com/bhh1893/health-tracker/issues/6): HTTPS moves to v2, and the design for it is recorded below so v2 starts from here.

## Shape (v1)

- **Gateway:** one `Gateway` in namespace `edge`, owned by `k8s/platform` (ADR 0003), listening on `:80`. The Service Cilium creates for it takes `192.168.0.250` from the pool (`.251` spare). It admits `HTTPRoute`s from the app namespace only. The routes themselves ship with each service's Kustomize base: `/api/*` to the `api` pod's sidecar port, `/` to `web`. `/healthz` and `/readyz` are not routed (ADR 0006).
- **What the secret protects:** `/api/*` only. `web` is public on the LAN and holds no data; the SPA shows its own "enter secret" screen.
- **How the phone presents it:** `Authorization: Bearer <secret>`, entered once, kept in `localStorage`, attached by one `openapi-fetch` middleware (ADR 0007). HTTP Basic Auth was rejected: browser-managed credentials are unreliable in iOS home-screen apps.
- **The sidecar:** `nginx-unprivileged` in the `api` pod. The Gateway sends `/api/*` to the sidecar's port; it compares the bearer token with a secret file mounted from a Kubernetes Secret, then proxies to `api` on `localhost` (same pod, never on a network). uvicorn binds `127.0.0.1`, so the sidecar is the only way into `api`: no other pod can reach `:8000` and skip the token check. A missing or wrong token gets `401` `application/problem+json` with `WWW-Authenticate: Bearer`, matching ADR 0006. `api` contains no auth code.
- **Probes:** the kubelet probes the pod IP, which `api` no longer listens on, so `/healthz` and `/readyz` go through a second sidecar port that serves only those two paths, with no token. That port is reachable from other pods and exposes nothing but health status. It is not in the `Service`, so the Gateway cannot route to it.
- **Token:** at least 32 random bytes. Rotation = update the Secret, restart the pod, re-enter on the phone. nginx reads the file at start. Where the Secret is created and stored is decided in ADR 0015.
- **No rate limiting in v1:** a long random token makes guessing impractical. Plain nginx string comparison is not constant-time; irrelevant for one user on a home LAN.
- **WireGuard on:** Cilium transparent encryption encrypts all pod-to-pod traffic between nodes (Gateway to pod, `api` to Postgres, Postgres replication) with one Cilium value in the Ansible role (ADR 0004). It does not cover pods on the same node and is not identity-based mTLS. Verify it together with L2 announcement at build.
- **Client consequence:** the page is **not** a secure context over `http://192.168.0.250`, so `crypto.randomUUID`, service workers and the install prompt are unavailable. The client must build UUIDv7s from `crypto.getRandomValues` (available over HTTP); `web` must not call `crypto.randomUUID`. iOS "Add to Home Screen" still works.
- **Cilium version:** pin at or above 1.17.17 / 1.18.11 / 1.19.5, which fix a Gateway cross-namespace traffic-mirroring CVE.

## Considered Options

- **HTTPS in v1 (real domain, cert-manager, Let's Encrypt DNS-01).** Deferred to v2, not rejected. Its main benefit is that the bearer token no longer crosses the Wi-Fi in cleartext; its costs are a domain, a DNS API token, cert-manager, rate limits, and router DNS-rebinding risk. The decision was reversed because v1 is one user on a home Wi-Fi.
- **Check the secret in `api` middleware.** Rejected: puts auth code in the service the v2 swap should leave untouched.
- **`HTTPRoute` header match at the Gateway.** Rejected: the secret would sit in plain YAML (the Gateway API cannot read a match value from a Secret) and a mismatch is not a `401` problem+json.
- **Envoy `ext_authz` through a hand-written `CiliumEnvoyConfig`.** Rejected: unsupported by Cilium's Gateway API docs, with reports of traffic hanging.
- **Envoy Gateway just for its `SecurityPolicy`.** Rejected: a second gateway control plane next to Cilium.
- **oauth2-proxy / OIDC proxy now.** Deferred to v2: heavier than one static token needs.
- **Keep `api` on `0.0.0.0` and add a NetworkPolicy.** Rejected: a mistake in the policy leaves `api` open with nothing failing to show it. A mistake in the localhost bind and probe port fails the probes, so the pod never goes ready.
- **HTTP Basic Auth.** Rejected, see above.
- **Cookie login.** Rejected: a login endpoint is more machinery than a shared secret deserves.

## Consequences

- **v1 security posture:** the bearer token crosses the home Wi-Fi in cleartext, so anyone who can listen on that network can read or write the app's data through the API. Accepted for one user and low-sensitivity data. The workers sit on the home LAN through their bridged NIC, so the node firewall (ansible role) should admit only port 80 on that NIC. Amended by ADR 0019: a role alone cannot see NodePorts, so `nodePort.addresses` closes those.
- **Amends** ADR 0001 ("one TLS cert" is a v2 property) and ADR 0006 (`401` now comes from the sidecar, not the Gateway). The v1 `api` Deployment has two containers.
- **v2: swap the auth.** Replace the nginx sidecar with oauth2-proxy or an OIDC-aware proxy. `api` and the Gateway config do not change; this was the reason for choosing a sidecar.

## v2 starting point: HTTPS (decided, not built)

- **Domain and DNS:** a real domain on Cloudflare, `health.<domain>` with a public A record to `192.168.0.250`. First check that the router does not drop private-IP DNS answers (rebinding protection).
- **Certificates:** cert-manager with a Let's Encrypt DNS-01 `ClusterIssuer` (Cloudflare). The `Gateway` carries the `cert-manager.io/cluster-issuer` annotation and a TLS listener on `:443`; the certificate Secret must live in the Gateway's namespace (`edge`). Requires `config.gatewayAPI.enabled: true`.
- **Redirect:** `:80` becomes a `RequestRedirect` (scheme `https`) listener. The HTTPS decision (issue 6) carries the rest.
- **Issuers:** production by default, with a Let's Encrypt staging issuer to use while iterating on the cert flow. Rebuilds re-issue a certificate each time; Let's Encrypt allows only a few identical certificates per week (verify the current limit).
- **No HSTS at first:** a phone that cached it cannot click through a certificate failure after a rebuild. Revisit once rebuilds are rare.
- **Per-hop TLS:** Gateway to pods via `BackendTLSPolicy`, with a cert-manager internal CA and a certificate per service, replacing WireGuard's role for in-cluster traffic or sitting beside it.
- **Client:** HTTPS makes the page a secure context, so service workers (offline logging, `web` ADR 0007) become possible.
