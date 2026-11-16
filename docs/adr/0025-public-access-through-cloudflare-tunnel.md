---
status: accepted
---

# Public access through Cloudflare Tunnel at `health.nibblejiggle.xyz`, TLS at Cloudflare and again at the Gateway

Anyone on the internet can reach the app at `https://health.nibblejiggle.xyz`; Approval, not the network, decides who gets past the Pending screen. There is no router access, so nothing can be port-forwarded: an in-cluster `cloudflared` dials out to Cloudflare and holds a tunnel open, and Cloudflare sends requests back down it. Browser TLS ends at Cloudflare's edge; `cloudflared` opens a second, verified TLS connection to the Cilium Gateway, which keeps its own Let's Encrypt certificate. This supersedes ADR 0020 and amends ADR 0010 ([Way in and where TLS ends](https://github.com/bhh1893/health-tracker/issues/173), facts in [Public way in to a home cluster](https://github.com/bhh1893/health-tracker/issues/171)).

## Shape

- **Path:** browser -> Cloudflare edge (TLS 1 ends: Universal SSL certificate; WAF, rate limiting, bot checks run on the decrypted request) -> tunnel -> `cloudflared` pod -> Gateway Service `:443` (TLS 2 ends at Envoy) -> `HTTPRoute`s -> oauth2-proxy sidecars (ADR 0021) -> `api` / `web`. No Cloudflare code in `api` or `web`.
- **Way in:** Cloudflare Tunnel, the only free outbound tunnel that serves a custom domain (ngrok Free and Tailscale Funnel do not). `cloudflared` runs as a workload in the cluster, not on a VM. Its deployment shape, where tunnel routes live and how the token survives rebuilds are in ADR 0029: Terraform in `iac/cloudflare/`, a remotely managed tunnel, a plain Deployment in `edge` ([Tunnel config, credential and rebuild](https://github.com/bhh1893/health-tracker/issues/180)).
- **Domain and DNS (carried from ADR 0020):** Porkbun stays the registrar; DNS hosting moves to a free Cloudflare account (DNSSEC off at Porkbun, change nameservers, re-enable DNSSEC through Cloudflare). `health` is a proxied (orange cloud) CNAME to `<tunnel-uuid>.cfargotunnel.com`, which only works when the zone and the tunnel are on the same Cloudflare account. The apex stays free for other uses: separate origins keep a future app on another name from reading this one.
- **Origin leg:** `cloudflared` targets `https://<Gateway Service>.edge.svc.cluster.local:443` with `originServerName: health.nibblejiggle.xyz`, which sets the SNI the listener needs and the name the certificate is checked against. `noTLSVerify` is never used. The zone's SSL mode does not govern tunnel traffic, so no Cloudflare Origin CA certificate is needed.
- **Certificates (carried from ADR 0020):** cert-manager with `config.gatewayAPI.enabled: true` (Gateway API CRDs first), a Cloudflare DNS-01 `ClusterIssuer` (staging while building, production after), the `cert-manager.io/cluster-issuer` annotation on the Gateway, Secret in `edge`. The DNS-01 token is scoped to editing DNS in the one zone and is never reused for anything else, such as Terraform. After first issuance the TLS Secret is saved to the dev VM and restored by `apply-secrets` before the Gateway, so rebuilds do not re-issue (Let's Encrypt: 5 certificates per name per 7 days).
- **Listeners:** one, HTTPS `:443` with `hostname: health.nibblejiggle.xyz` and `tls.mode: Terminate`. The `:80` listener is removed: browsers never reach the Gateway, so Cloudflare's "Always Use HTTPS" does the redirect at the edge.
- **HSTS (amends ADR 0010):** on at Cloudflare's edge, `max-age` 6 months, no `includeSubDomains`, no preload.
- **Client IP:** Envoy sees `cloudflared` as the client. `api` reads the visitor IP from `CF-Connecting-IP` only, which Cloudflare sets and overwrites, for logs and rate limiting. `gatewayAPI.xffNumTrustedHops` stays `0`; `X-Forwarded-For` is never used for identity, because its left entries are client-controlled and its hop count changes with every proxy added.
- **Origin lockdown:** the header is trustworthy only if nothing else can reach the Gateway. The Gateway gets no address outside the cluster on the public path (no LoadBalancer IP on the LAN), and a Cilium network policy admits only `cloudflared` pods to the Gateway's Envoy. Any owner-only path kept by [Tailscale and the LAN path after going public](https://github.com/bhh1893/health-tracker/issues/177) is listed in that policy and accepted: only the owner could forge the header there.
- **Tailscale and the LAN path:** open. [Tailscale and the LAN path after going public](https://github.com/bhh1893/health-tracker/issues/177) decides whether the Tailscale Operator, `svc:health`, split DNS and the LAN path stay; its answer amends this ADR.
- **Secrets (amends ADR 0015):** the Cloudflare DNS-01 token as in ADR 0020; the tunnel token and the Terraform token per ADR 0029.

## Considered Options

- **HTTP from `cloudflared` to the Gateway's `:80`.** Rejected: it drops cert-manager, the DNS token and the TLS Secret restore, but the Gateway would stop being an HTTPS origin on its own, so swapping Cloudflare for a cloud load balancer later would change the cluster (portability constraint). It also leaves a cleartext hop in the cluster (covered by WireGuard only between nodes) and breaks the `:80` redirect, which would loop.
- **`cloudflared` on a VM outside the cluster.** Rejected: one more host for the rebuild to manage, and its hop into the cluster crosses a network boundary instead of staying pod to pod.
- **`xffNumTrustedHops: 1` instead of `CF-Connecting-IP`.** Rejected: correct only while the proxy count stays exactly right; the `api` pod's own sidecar appends to `X-Forwarded-For` too, so it breaks silently when the chain changes.
- **Trust whatever reaches the Gateway.** Rejected: any pod, or anything on the LAN, could set `CF-Connecting-IP` and dodge per-IP limits.
- **Keep `:80` as a redirect for portability.** Rejected: nothing legitimate reaches it, and re-adding it when something other than Cloudflare fronts the Gateway is a small change.
- **App on the apex `nibblejiggle.xyz`.** Rejected: works on Cloudflare (CNAME flattening), but uses up the apex for one app.

## Consequences

- **Cloudflare reads all traffic:** URLs, the `__Host-health_session` cookie, the OIDC callback `code`, and logged data. Cloudflare joins Google as a trusted third party; [Public threat model](https://github.com/bhh1893/health-tracker/issues/179) weighs this.
- **ADR 0010's reason to defer HSTS no longer holds:** browsers only see Cloudflare's certificate, which a rebuild never touches. A broken Gateway certificate shows up as a Cloudflare `502`, not a browser certificate error.
- Tunnel down (home connection, `cloudflared` crashed) shows visitors Cloudflare error `1033`. Free limits apply: 100 MB request body, 125 s to the first byte (`524`).
- The hostname is public in Certificate Transparency logs and now resolves to Cloudflare, not to the origin's address.
- The Gateway policy is the repo's first network policy. Write it to select only the Gateway: once a policy selects an endpoint, Cilium drops all other traffic to that endpoint by default.
- **Verify at build:** Cilium 1.20.4 can make the generated Gateway Service ClusterIP-only (expected through `CiliumGatewayClassConfig`); a Cilium policy on the `reserved:ingress` identity limits who reaches Envoy; `cloudflared` passes certificate verification with `originServerName`; Cloudflare overwrites a client-sent `CF-Connecting-IP`; restoring the certificate on rebuild issues no new certificate.
