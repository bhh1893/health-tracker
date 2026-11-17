# Request path: phone to database

One request, followed hop by hop from the phone to Postgres. It grows as the build tickets land: each ticket fills in the steps it builds.

Two separate questions are answered on the way:

1. **Can this device reach the server at all?** The network: DNS, Cloudflare, the tunnel, Cilium. Asked on every request.
2. **Who is this person?** Identity: Google and oauth2-proxy. Google is asked once at sign-in, then not again for 30 days.

Google never talks to the cluster. The phone carries messages between Google and the proxy by following redirects.

## How to use this doc

- Each step has four parts: **What** it is, what it **Decides**, how to **Watch** it happen, and how it **Fails**.
- Steps not built yet are marked with the ticket that builds them. Fill in Watch and Fails during that ticket, from what you actually saw.
- Questions go in [Open questions](#open-questions). Move each one into a step once it is answered.
- Self-test after each ticket: draw the whole path on a blank page from memory, then compare.

## The map

```text
                                     every request
phone ──1 DNS──> Cloudflare edge ──2 TLS 1 ends, rules run──> 3 tunnel ──> cloudflared pod
                                                                               │ TLS 2, SNI app.nibblejiggle.xyz
                                                       4 Gateway (Envoy, TLS 2 ends) ──HTTPRoute by path──┐
                                                                                                         │
                         7 api <──127.0.0.1── 6 oauth2-proxy sidecar <── 5 Service picks a ready pod <───┘
                           │
                        Postgres

                                     first visit only
phone <──redirect──> accounts.google.com            proxy ──code for tokens──> Google
```

| Step | Today | Target | Built by |
| --- | --- | --- | --- |
| 1 DNS | `health` is a proxied CNAME to the tunnel, so it resolves to Cloudflare's edge | same | #146, #188 |
| 2 Cloudflare edge | browser TLS ends; Always Use HTTPS, HSTS, the `/oauth2/` rate limit; sets `CF-Connecting-IP` | same | #188 |
| 3 Tunnel | 2 `cloudflared` pods, 4 QUIC connections each, forward to the Gateway | same | #189 |
| 4 Gateway | Envoy, HTTPS on `:443` only, reachable only from `cloudflared`; no address outside the cluster | same | #146, #147 |
| 5 Service | same | same | - |
| 6 Sidecar | oauth2-proxy checks a session cookie (`api` and `web`); any Google account | same | #150, #151 |
| 7 `api` | per-User rate and write limits; caller's User from proxy headers; unknown signs up as Pending; Pending gets `403` | same | #151, #192 |

## Every request

### 1. DNS (zone moved in #146; record in #188)

- **What:** the phone turns `app.nibblejiggle.xyz` into an IP address. Its resolver asks the root servers, then the `.xyz` registry (which says "ask `jamie` and `luke.ns.cloudflare.com`", the delegation Porkbun set), then Cloudflare's nameservers.
- **Decides:** where the phone connects. With a proxied (orange cloud) record, Cloudflare answers with its own edge addresses, never the home's, so every request lands at Cloudflare first (ADR 0025).
- **Built in #146 and #188:** Cloudflare hosts the zone; Porkbun stays the registrar. DNSSEC is on: the registry holds a DS record (key tag `2371`) vouching for the key Cloudflare signs answers with, so a forged answer fails validation. Terraform (`iac/cloudflare/tunnel.tf`) adds `health` as a proxied CNAME to `<tunnel-id>.cfargotunnel.com`.
- **Watch:**
  - `dig +noall +authority NS nibblejiggle.xyz @x.nic.xyz` (the delegation at the registry)
  - `delv @1.1.1.1 nibblejiggle.xyz SOA` (`; fully validated`: the DNSSEC chain holds)
  - `dig +short app.nibblejiggle.xyz @1.1.1.1` (Cloudflare addresses, never the home's)
  - `docs/runbooks/cloudflare.md` for how it was set up
- **Fails:**
  - No record: `NXDOMAIN`, the browser says the site cannot be found. True for any other name in the zone, such as `nope.nibblejiggle.xyz`.
  - DS record not matching Cloudflare's key: `SERVFAIL` from validating resolvers such as `1.1.1.1` and `8.8.8.8`, so the name stops resolving for everyone using one, all at once. Fix by deleting the DS record at Porkbun first.
  - Right after a nameserver change, resolvers can serve the old answer for up to the registry's TTL, 3600 s.

### 2. Cloudflare's edge (built in #188)

- **What:** the nearest Cloudflare data centre (`cf-ray` ends in its code, e.g. `-SJC`). The browser's TLS ends here, with Cloudflare's certificate, so Cloudflare can read the request (ADR 0025).
- **Decides:** whether the request goes on at all. Always Use HTTPS redirects `http://`; the rate limiting rule blocks an IP hammering `/oauth2/` (ADR 0027); the Sign-up brake, when on, blocks `/oauth2/start`. It adds `CF-Connecting-IP`, the visitor's address, overwriting any value the client sent, and HSTS on every response.
- **Watch:**
  - `curl -sI https://app.nibblejiggle.xyz/` (`server: cloudflare`, `cf-ray`, `strict-transport-security: max-age=15552000`)
  - Cloudflare dashboard, Security, Events (each rate-limit or brake block)
- **Fails:**
  - No connector on the tunnel: `530` (Cloudflare error `1033`). Seen on 2026-11-17 before `cloudflared` was deployed.
  - Rate limited: `429` with `retry-after`. The count is approximate: at build the first `429` came at request 45, not 21 (ADR 0027).
  - Gateway certificate fails `cloudflared`'s check: `502`. The browser never sees a certificate warning.

### 3. The tunnel and `cloudflared` (built in #189)

- **What:** two `cloudflared` pods in `edge` (`k8s/platform/edge/cloudflared/deployment.yaml`), one per worker. Each dialled *out* to Cloudflare on `7844` and holds 4 QUIC connections to nearby data centres; nothing at home accepts an inbound connection. Cloudflare sends the request down one of them.
- **Decides:** which origin gets the request, by hostname, from the routes Cloudflare pushed (`iac/cloudflare/tunnel.tf`): `app.nibblejiggle.xyz` goes to `https://cilium-gateway-edge.edge.svc.cluster.local:443`, anything else to `http_status:404`. `cloudflared` opens a second TLS connection, sends `app.nibblejiggle.xyz` as SNI and checks the Gateway's certificate against that name (`originServerName`).
- **Fenced:** `k8s/platform/edge/cloudflared/network-policy.yaml` lets `cloudflared` reach DNS, Cloudflare's tunnel edge and the `api` and `web` pods on `8080`, nothing else. The backends are listed rather than the Gateway because Cilium checks Envoy's hop to the backend against the client's egress policy (ADR 0029, "Verified at build").
- **Watch:**
  - `kubectl -n edge get pods -o wide -l app.kubernetes.io/name=cloudflared` (two pods, two workers)
  - `kubectl -n edge logs deploy/cloudflared | grep -E "Registered|Updated to new configuration"` (connections and the routes received)
  - Zero Trust dashboard, Networks, Connectors: exactly two connectors, both from the home IP (the monthly check, ADR 0030)
- **Fails:**
  - Home internet down: `/ready` fails, the liveness probe restarts the pods in a loop, visitors get `530`.
  - A backend missing from the egress policy: Envoy answers `403` with the plain-text body `Access denied`. Seen at build; `cilium-dbg monitor -t l7` on the node shows `verdict Denied`.
  - The precheck line `Cloudflare API ... FAIL` at startup is expected: the policy blocks `api.cloudflare.com`, used only for auto-update.

### 4. Gateway (HTTPS built in #146, locked to the tunnel in #147)

- **What:** the Gateway `edge` (`k8s/platform/edge/gateway.yaml`). Cilium runs Envoy to serve it and makes the Service `cilium-gateway-edge`, which `gateway-class.yaml` keeps inside the cluster: no outside IP, no NodePorts. eBPF on the node hands packets for the Service's cluster IP to Envoy.
- **Decides:** which backend gets the request, by path, using the `HTTPRoute`s that live with each service. Longest prefix wins: `/api` goes to the `api` Service (`services/api/k8s/httproute.yaml`), everything else to `web` (`services/web/k8s/httproute.yaml`).
- **TLS ends here (#146):** the `https` listener on `:443` holds a Let's Encrypt certificate for `app.nibblejiggle.xyz` in Secret `edge/health-tls`. A client must send that name as SNI, or Envoy has no certificate to offer. Before this step the request is encrypted; after it, Envoy can read the path.
  - **Where the certificate comes from:** the Gateway's `cert-manager.io/cluster-issuer: letsencrypt-production` annotation makes cert-manager create a `Certificate`. It proves control with DNS-01: writes a `TXT` record at `_acme-challenge.app.nibblejiggle.xyz` through the Cloudflare API, Let's Encrypt looks it up, the record is deleted. The Gateway never needs to be reachable from the internet for this. Renewal is automatic at two thirds of the 90 days.
  - **Rebuilds:** `save-tls` keeps a copy on the dev VM, and `apply-secrets` restores it before the Gateway exists, so a rebuild issues nothing (Let's Encrypt allows 5 per name per 7 days).
  - **Twice (ADR 0025):** the browser's TLS ends at Cloudflare's edge (step 2); `cloudflared` opens a second TLS connection to this listener (step 3). There is no `:80` listener: Cloudflare redirects `http://` at its edge.
- **Fenced (#147):** `k8s/platform/edge/gateway-policy.yaml` selects Envoy's reserved `ingress` identity and admits only `cloudflared` pods on `443`. Without it any pod could reach the Gateway and set `CF-Connecting-IP`, the header `api` trusts as the visitor's address.
- **Watch:**
  - `kubectl get gateway -n edge`: `PROGRAMMED False` is expected, since the Service never gets an outside address. Check the listeners instead: `kubectl get gateway edge -n edge -o jsonpath='{range .status.listeners[*]}{.name}{" "}{.conditions[?(@.type=="ResolvedRefs")].status}{"\n"}{end}'` (`True`: the certificate Secret is found)
  - `kubectl get svc -n edge` (the Service Cilium made: `EXTERNAL-IP <pending>`, port `443` with no NodePort)
  - `kubectl get httproute -n health-tracker -o wide`
  - `kubectl get certificate,certificaterequest,order,challenge -n edge` (one issuance, in the order it happens)
  - From the dev VM, through the tunnel: `curl -sI https://app.nibblejiggle.xyz/` (Envoy's answer carries `x-envoy-upstream-service-time`; a certificate problem here shows as `502`)
- **Fails:**
  - No route matches: `404` from Envoy. A route with no ready backend: `503` (`no healthy upstream`).
  - Secret missing: the `https` listener shows `ResolvedRefs=False` (`InvalidCertificateRef`) and `:443` refuses the handshake. Seen on 2026-11-16 for the 2 minutes before the first issuance.
  - Issuance stuck: read `kubectl describe challenge -n edge`. `Waiting for DNS-01 challenge propagation` for a minute or two is normal; anything longer is usually the token (wrong scope, rolled) or the zone. A failed attempt backs off from 1 hour, doubling.
  - Wrong SNI: no listener matches the name, so the handshake fails. Through the tunnel, `originServerName` always sends the right one.
  - A client other than `cloudflared`: Envoy answers `403` with the plain-text body `Access denied`, the same answer as a backend missing from `cloudflared`'s egress policy (step 3). Cilium enforces the policy inside Envoy, after the TLS handshake, so the connection opens and the request is refused.
  - Through the tunnel, a broken certificate here shows as a Cloudflare `502`, not a browser warning: the browser only ever sees Cloudflare's certificate.

### 5. Service picks a pod (exists)

- **What:** the `api` Service (`services/api/k8s/service.yaml`) selects pods labelled `app.kubernetes.io/name: api`. Kubernetes keeps an EndpointSlice listing only the pods whose readiness probe passes. Envoy sends the request straight to one of those pod IPs.
- **Decides:** which `api` pod answers. There are two, one per worker.
- **Note:** if the chosen pod is on another node, Cilium encrypts node-to-node traffic with WireGuard (`encryption` in `k8s/platform/cilium/values.yaml`).
- **Watch:**
  - `kubectl get pods -n health-tracker -o wide` (pod IPs and nodes)
  - `kubectl get endpointslices -n health-tracker -l kubernetes.io/service-name=api`
- **Fails:** a pod failing `/readyz` drops out of the EndpointSlice and gets no traffic. If both fail, step 4 returns `503`.

### 6. Sidecar: oauth2-proxy (built in #150)

- **What:** an `auth-proxy` native sidecar in every `api` and `web` pod, patched into each Deployment by `k8s/components/auth-proxy/` (included by `k8s/envs/vagrant/kustomization.yaml`). The Service's `targetPort: http` is its port `8080`. Behind it, the app container listens on `127.0.0.1:8000` only: uvicorn in `api`, nginx in `web`.
- **Decides:** whether the request gets in, and who it is from.
  - Valid `__Host-health_session` cookie: delete any `X-Auth-*` headers the client sent, add the real ones (`X-Auth-Issuer`, `X-Auth-Subject`, `X-Auth-Name`, `X-Auth-Email`), forward to `127.0.0.1:8000`.
  - No session, `/api/*` (or `Accept: application/json`): `401`.
  - No session, anything else: the Sign-in page (`sign_in.html`), status `403`.
  - `GET /healthz` and `GET /readyz` pass with no session, for the kubelet's probes.
- **How it checks the cookie without Google:** the cookie is encrypted and signed with the cookie secret and carries its sign-in time. A cookie this proxy did not make fails the signature; one older than 30 days fails the age check. Google's ID token was checked once, at sign-in, with keys from Google's discovery document.
- **Watch:**
  - `curl -s -o /dev/null -w '%{http_code}\n' https://app.nibblejiggle.xyz/api/v1/meals` (`401`)
  - `curl -s https://app.nibblejiggle.xyz/ | grep 'Sign in with'` (the Sign-in page)
  - `kubectl -n health-tracker logs deploy/web -c auth-proxy` (one line per request: who, path, status; and `AuthSuccess` / `AuthFailure` at sign-in)
  - `kubectl -n health-tracker get pods` (`2/2` when both the sidecar and the app are ready)
- **Fails:**
  - Proxy cannot reach Google at start (discovery): it exits, the pod shows `CrashLoopBackOff`, and the app container never starts. Fails closed.
  - `auth-proxy` Secret missing: the pod stays in `CreateContainerConfigError` or `ContainerCreating` until `apply-secrets` runs.
  - App not on `127.0.0.1:8000`: the probes fail and the pod never goes ready, so the Service never sends it traffic.
  - Alpha config in an old shape after a version bump: the proxy logs `has invalid keys` and exits. Seen while building #150 (v7.14 moved `claim:` under `claimSource:`).

### 7. `api` (reads proxy headers since #151, rate limits since #192)

- **What:** uvicorn binds `127.0.0.1:8000` (`services/api/Dockerfile:37`), so only containers in the same pod can reach it. Localhost is the trust boundary: anything that gets here came through the sidecar, which set the `X-Auth-*` headers.
- **Limits first:** `RateLimits` (`services/api/src/health_api/rate_limits.py`), an ASGI middleware, counts the request against the User's `(issuer, sub)` before routing: `RATE_LIMIT` (300/minute) on everything, `WRITE_RATE_LIMIT` (60/minute) also on `POST`, `PUT`, `PATCH`, `DELETE`. Past either, `429` Problem `urn:health-tracker:problem:rate-limited` with `Retry-After`, and no query is sent. Probes and requests with no identity pass through uncounted. Counters live in the pod's memory, so with 2 pods a User can get up to twice the limit (ADR 0027).
- **Decides:** who is calling, in `signed_in_user` (`services/api/src/health_api/identity.py`), before any route code runs.
  - No `X-Auth-Issuer` or `X-Auth-Subject`: `401` Problem. Never a fallback to the seeded User.
  - Known `(issuer, sub)`: one indexed `SELECT` on `users_issuer_subject_key`. `name`/`email` are written only if the headers differ from what is stored.
  - Unknown: `INSERT ... ON CONFLICT DO NOTHING` as Pending, committed at once. This is Sign-up.
  - Pending: `GET /api/me` answers `{ role: "pending", ... }`; every other route gets `403` `urn:health-tracker:problem:pending-approval` from `current_user`.
  - Member or Admin: the User's id scopes every query, as before.
- **Then:** queries Postgres through `DATABASE_URL` as the limited `api_rw` role.
- **Watch:**
  - The browser's network tab: `GET /api/me` returns `role` and `name`.
  - `iac/scripts/users list`: a first sign-in shows up as a Pending row with name and email.
  - `kubectl logs -n health-tracker deploy/api -c api | jq 'select(.logger == "health_api.access")'`: one line per request with `user_id`, `method`, the route template as `path`, `status` and the visitor's `client_ip` from `CF-Connecting-IP` (#191). Passing probes are left out.
- **Fails:**
  - Database unreachable: `503` Problem, from the identity lookup itself, since it is the first query of every request.
  - Proxy stops sending `X-Auth-Issuer`/`X-Auth-Subject` (alpha config regression): every request is `401`, and `web` reloads into sign-in in a loop. Fails closed.
  - Proxy stops sending `name`/`email`: the stored values stay; nothing breaks.
  - Over a limit: `429` with `Retry-After`; `web` shows "Too many requests. Wait a moment and try again." and does not retry. Seen in `kubectl logs -n health-tracker deploy/api -c api` as a `rate limit ... passed by` warning with the visitor IP.
  - `RATE_LIMIT` that does not parse: the new pods crash at boot, so the rollout stops and the old pods keep serving.

## First visit only: sign-in (built in #150)

1. `GET /` reaches the `web` pod's oauth2-proxy with no cookie. It serves the Sign-in page.
2. Tapping "Sign in with Google" hits `/oauth2/start`. The proxy sets a short-lived state cookie and redirects the phone to `accounts.google.com`.
3. The person signs in at Google. Google redirects the phone to `https://app.nibblejiggle.xyz/oauth2/callback?code=...&state=...`. Google never connects to the cluster; the phone's browser follows the redirect.
4. The proxy checks `state` against its cookie (proof this callback belongs to a sign-in it started), then calls Google directly, server to server, to trade the code for tokens using the client secret. The phone never sees a token.
5. The proxy verifies the ID token's signature and claims, sets the `__Host-health_session` cookie (encrypted with the cookie secret), and redirects back to the page originally asked for.
6. For 30 days, only the cookie matters. Google is out of the loop.

- **Watch:** the browser's network tab with "Preserve log" on shows each hop: `/oauth2/start` (`302` to Google, sets `__Host-health_session_csrf`), Google's pages, `/oauth2/callback?code=...&state=...` (`302` back, sets `__Host-health_session`, clears the CSRF cookie), then the page first asked for. `kubectl -n health-tracker logs deploy/web -c auth-proxy | grep -i auth` shows the callback's result.
- **Fails:**
  - The Google consent screen in Testing and the account not a test user: Google refuses at step 3 with `Error 403: access_denied`. oauth2-proxy never sees it.
  - Redirect URI mismatch (`--redirect-url` differs from the one registered): Google shows `Error 400: redirect_uri_mismatch` at step 3.
  - CSRF cookie missing at the callback (more than 15 minutes at Google, or a different browser): the proxy refuses the callback; start again.

## Open questions

- Where does Cilium's Envoy run, and how does eBPF hand it a packet addressed to the Gateway? Partly answered in #189: it runs per node, not as a pod, and the Gateway Service's only endpoint is the placeholder `192.192.192.192:9999`. The handoff itself (TPROXY) is still open.
- How does Envoy choose between the two `api` pods? (now)
- How does traffic leave the cluster when oauth2-proxy calls Google in step 4 of sign-in? Nothing restricts egress from the `health-tracker` namespace, so it leaves through the node like any pod's outbound connection. Which address Google sees (Cilium masquerading, then VirtualBox NAT) is still open.
