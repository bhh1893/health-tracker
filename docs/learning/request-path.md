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
                                                                               │ TLS 2, SNI health.nibblejiggle.xyz
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
| 1 DNS | `health` is a proxied CNAME to the tunnel, so it resolves to Cloudflare's edge; the LAN path still uses the raw IP `192.168.0.250` | same, LAN path gone | #146, #188 |
| 2 Cloudflare edge | browser TLS ends; Always Use HTTPS, HSTS, the `/oauth2/` rate limit; sets `CF-Connecting-IP` | same | #188 |
| 3 Tunnel | 2 `cloudflared` pods, 4 QUIC connections each, forward to the Gateway | same | #189 |
| 4 Gateway | Envoy, HTTPS on `:443` (tunnel and LAN) and HTTP on `:80` (LAN) | HTTPS on `:443` only, reachable only from `cloudflared` | #146, #147 removes `:80` |
| 5 Service | same | same | - |
| 6 Sidecar | nginx checks a static Bearer token (`api` only) | oauth2-proxy checks a session cookie (`api` and `web`) | #150 |
| 7 `api` | every caller is the seeded User | caller's User from proxy headers, Pending gets `403` | #151 |

## Every request

### 1. DNS (zone moved in #146; record in #188)

- **What:** the phone turns `health.nibblejiggle.xyz` into an IP address. Its resolver asks the root servers, then the `.xyz` registry (which says "ask `jamie` and `luke.ns.cloudflare.com`", the delegation Porkbun set), then Cloudflare's nameservers.
- **Decides:** where the phone connects. With a proxied (orange cloud) record, Cloudflare answers with its own edge addresses, never the home's, so every request lands at Cloudflare first (ADR 0025).
- **Built in #146 and #188:** Cloudflare hosts the zone; Porkbun stays the registrar. DNSSEC is on: the registry holds a DS record (key tag `2371`) vouching for the key Cloudflare signs answers with, so a forged answer fails validation. Terraform (`iac/cloudflare/tunnel.tf`) adds `health` as a proxied CNAME to `<tunnel-id>.cfargotunnel.com`.
- **Watch:**
  - `dig +noall +authority NS nibblejiggle.xyz @x.nic.xyz` (the delegation at the registry)
  - `delv @1.1.1.1 nibblejiggle.xyz SOA` (`; fully validated`: the DNSSEC chain holds)
  - `dig +short health.nibblejiggle.xyz @1.1.1.1` (Cloudflare addresses, never the home's)
  - `docs/runbooks/cloudflare.md` for how it was set up
- **Fails:**
  - No record: `NXDOMAIN`, the browser says the site cannot be found. True for any other name in the zone, such as `nope.nibblejiggle.xyz`.
  - DS record not matching Cloudflare's key: `SERVFAIL` from validating resolvers such as `1.1.1.1` and `8.8.8.8`, so the name stops resolving for everyone using one, all at once. Fix by deleting the DS record at Porkbun first.
  - Right after a nameserver change, resolvers can serve the old answer for up to the registry's TTL, 3600 s.

### 2. Cloudflare's edge (built in #188)

- **What:** the nearest Cloudflare data centre (`cf-ray` ends in its code, e.g. `-SJC`). The browser's TLS ends here, with Cloudflare's certificate, so Cloudflare can read the request (ADR 0025).
- **Decides:** whether the request goes on at all. Always Use HTTPS redirects `http://`; the rate limiting rule blocks an IP hammering `/oauth2/` (ADR 0027); the Sign-up brake, when on, blocks `/oauth2/start`. It adds `CF-Connecting-IP`, the visitor's address, overwriting any value the client sent, and HSTS on every response.
- **Watch:**
  - `curl -sI https://health.nibblejiggle.xyz/` (`server: cloudflare`, `cf-ray`, `strict-transport-security: max-age=15552000`)
  - Cloudflare dashboard, Security, Events (each rate-limit or brake block)
- **Fails:**
  - No connector on the tunnel: `530` (Cloudflare error `1033`). Seen on 2026-11-17 before `cloudflared` was deployed.
  - Rate limited: `429` with `retry-after`. The count is approximate: at build the first `429` came at request 45, not 21 (ADR 0027).
  - Gateway certificate fails `cloudflared`'s check: `502`. The browser never sees a certificate warning.

### 3. The tunnel and `cloudflared` (built in #189)

- **What:** two `cloudflared` pods in `edge` (`k8s/platform/edge/cloudflared/deployment.yaml`), one per worker. Each dialled *out* to Cloudflare on `7844` and holds 4 QUIC connections to nearby data centres; nothing at home accepts an inbound connection. Cloudflare sends the request down one of them.
- **Decides:** which origin gets the request, by hostname, from the routes Cloudflare pushed (`iac/cloudflare/tunnel.tf`): `health.nibblejiggle.xyz` goes to `https://cilium-gateway-edge.edge.svc.cluster.local:443`, anything else to `http_status:404`. `cloudflared` opens a second TLS connection, sends `health.nibblejiggle.xyz` as SNI and checks the Gateway's certificate against that name (`originServerName`).
- **Fenced:** `k8s/platform/edge/cloudflared/network-policy.yaml` lets `cloudflared` reach DNS, Cloudflare's tunnel edge and the `api` and `web` pods on `8080`, nothing else. The backends are listed rather than the Gateway because Cilium checks Envoy's hop to the backend against the client's egress policy (ADR 0029, "Verified at build").
- **Watch:**
  - `kubectl -n edge get pods -o wide -l app.kubernetes.io/name=cloudflared` (two pods, two workers)
  - `kubectl -n edge logs deploy/cloudflared | grep -E "Registered|Updated to new configuration"` (connections and the routes received)
  - Zero Trust dashboard, Networks, Connectors: exactly two connectors, both from the home IP (the monthly check, ADR 0030)
- **Fails:**
  - Home internet down: `/ready` fails, the liveness probe restarts the pods in a loop, visitors get `530`.
  - A backend missing from the egress policy: Envoy answers `403` with the plain-text body `Access denied`. Seen at build; `cilium-dbg monitor -t l7` on the node shows `verdict Denied`.
  - The precheck line `Cloudflare API ... FAIL` at startup is expected: the policy blocks `api.cloudflare.com`, used only for auto-update.

### 4. Gateway (HTTPS built in #146)

- **What:** the Gateway `edge` (`k8s/platform/edge/gateway.yaml`). Cilium turns it into a LoadBalancer Service and runs Envoy to serve it. eBPF on the node hands packets for the Gateway's address to Envoy.
- **Decides:** which backend gets the request, by path, using the `HTTPRoute`s that live with each service. Longest prefix wins: `/api` goes to the `api` Service (`services/api/k8s/httproute.yaml`), everything else to `web` (`services/web/k8s/httproute.yaml`). Routes name no hostname, so they attach to both listeners.
- **TLS ends here (#146):** the `https` listener on `:443` holds a Let's Encrypt certificate for `health.nibblejiggle.xyz` in Secret `edge/health-tls`. A client must send that name as SNI, or Envoy has no certificate to offer. Before this step the request is encrypted; after it, Envoy can read the path.
  - **Where the certificate comes from:** the Gateway's `cert-manager.io/cluster-issuer: letsencrypt-production` annotation makes cert-manager create a `Certificate`. It proves control with DNS-01: writes a `TXT` record at `_acme-challenge.health.nibblejiggle.xyz` through the Cloudflare API, Let's Encrypt looks it up, the record is deleted. The Gateway never needs to be reachable from the internet for this. Renewal is automatic at two thirds of the 90 days.
  - **Rebuilds:** `save-tls` keeps a copy on the dev VM, and `apply-secrets` restores it before the Gateway exists, so a rebuild issues nothing (Let's Encrypt allows 5 per name per 7 days).
  - **Twice (ADR 0025):** the browser's TLS ends at Cloudflare's edge (step 2); `cloudflared` opens a second TLS connection to this listener (step 3). `:80` goes in #147.
- **Watch:**
  - `kubectl get gateway -n edge` (address, `PROGRAMMED`), and per listener: `kubectl get gateway edge -n edge -o jsonpath='{range .status.listeners[*]}{.name}{" "}{.conditions[?(@.type=="Programmed")].status}{"\n"}{end}'`
  - `kubectl get svc -n edge` (the LoadBalancer Service Cilium made; ports `80` and `443`)
  - `kubectl get httproute -n health-tracker -o wide`
  - `kubectl get certificate,certificaterequest,order,challenge -n edge` (one issuance, in the order it happens)
  - `curl --resolve health.nibblejiggle.xyz:443:192.168.0.250 https://health.nibblejiggle.xyz/` (a handshake that checks the certificate; no `-k`)
  - `openssl s_client -connect 192.168.0.250:443 -servername health.nibblejiggle.xyz </dev/null | openssl x509 -noout -issuer -dates`
- **Fails:**
  - No route matches: `404` from Envoy. A route with no ready backend: `503` (`no healthy upstream`).
  - Secret missing: the `https` listener shows `ResolvedRefs=False` (`InvalidCertificateRef`) and `:443` refuses the handshake; `:80` keeps working. Seen on 2026-11-16 for the 2 minutes before the first issuance.
  - Issuance stuck: read `kubectl describe challenge -n edge`. `Waiting for DNS-01 challenge propagation` for a minute or two is normal; anything longer is usually the token (wrong scope, rolled) or the zone. A failed attempt backs off from 1 hour, doubling.
  - Wrong SNI, such as `curl https://192.168.0.250`: no listener matches the name, so the handshake fails.
  - Through the tunnel, a broken certificate here shows as a Cloudflare `502`, not a browser warning: the browser only ever sees Cloudflare's certificate.

### 5. Service picks a pod (exists)

- **What:** the `api` Service (`services/api/k8s/service.yaml`) selects pods labelled `app.kubernetes.io/name: api`. Kubernetes keeps an EndpointSlice listing only the pods whose readiness probe passes. Envoy sends the request straight to one of those pod IPs.
- **Decides:** which `api` pod answers. There are two, one per worker.
- **Note:** if the chosen pod is on another node, Cilium encrypts node-to-node traffic with WireGuard (`encryption` in `k8s/platform/cilium/values.yaml`).
- **Watch:**
  - `kubectl get pods -n health-tracker -o wide` (pod IPs and nodes)
  - `kubectl get endpointslices -n health-tracker -l kubernetes.io/service-name=api`
- **Fails:** a pod failing `/readyz` drops out of the EndpointSlice and gets no traffic. If both fail, step 4 returns `503`.

### 6. Sidecar (exists; becomes oauth2-proxy in #150)

- **What (today):** the `auth-sidecar` nginx container in the `api` pod (`services/api/k8s/sidecar/nginx.conf`). The Service's `targetPort: http` is its port `8080`. On `/api/` it compares the `Authorization` header with `Bearer <api-token>`, removes the header, and forwards to `127.0.0.1:8000`. Port `8081` passes probes through without a token. The `web` pod has no sidecar today.
- **What (target):** oauth2-proxy in both pods. No valid session cookie: `401` on `/api/*`, the Sign-in page everywhere else. Valid cookie: it removes any identity headers the client sent, adds the real ones (issuer, `sub`, `name`, `email`), and forwards to `127.0.0.1`.
- **Decides:** whether the request is allowed in at all, and (target) who it is from.
- **Watch (today):**
  - From Windows on home Wi-Fi: `curl.exe -i http://192.168.0.250/api/v1/meals` returns `401` with a Problem body.
  - `kubectl logs -n health-tracker deploy/api -c auth-sidecar`
- **Fails (today):** wrong or missing token gives `401` from nginx; `api` never sees the request.

### 7. `api` (exists; reads proxy headers in #151)

- **What:** uvicorn binds `127.0.0.1:8000` (`services/api/Dockerfile:34`), so only containers in the same pod can reach it. Localhost is the trust boundary: anything that gets here came through the sidecar.
- **Decides (today):** nothing about identity. `current_user` returns the seeded User for every request (`services/api/src/health_api/identity.py:13`).
- **Decides (target):** looks up `(issuer, sub)` from the headers. Unknown: signs the person up as Pending. Pending: `403` on everything but `GET /api/me`. Otherwise: their User ID scopes every query.
- **Then:** queries Postgres through `DATABASE_URL` as the limited `api_rw` role.
- **Watch:** `kubectl logs -n health-tracker deploy/api -c api`
- **Fails:** database unreachable gives a `503` Problem.

## First visit only: sign-in (built in #150)

1. `GET /` reaches the `web` pod's oauth2-proxy with no cookie. It serves the Sign-in page.
2. Tapping "Sign in with Google" hits `/oauth2/start`. The proxy sets a short-lived state cookie and redirects the phone to `accounts.google.com`.
3. The person signs in at Google. Google redirects the phone to `https://health.nibblejiggle.xyz/oauth2/callback?code=...&state=...`. Google never connects to the cluster; the phone's browser follows the redirect.
4. The proxy checks `state` against its cookie (proof this callback belongs to a sign-in it started), then calls Google directly, server to server, to trade the code for tokens using the client secret. The phone never sees a token.
5. The proxy verifies the ID token's signature and claims, sets the `__Host-health_session` cookie (encrypted with the cookie secret), and redirects back to the page originally asked for.
6. For 30 days, only the cookie matters. Google is out of the loop.

- **Watch:** fill in during #150. Use the browser's network tab with "Preserve log" on to see each redirect and cookie.
- **Fails:** fill in during #150.

## Open questions

- Where does Cilium's Envoy run, and how does eBPF hand it a packet addressed to the Gateway? Partly answered in #189: it runs per node, not as a pod, and the Gateway Service's only endpoint is the placeholder `192.192.192.192:9999`. The handoff itself (TPROXY) is still open.
- How does Envoy choose between the two `api` pods? (now)
- How does traffic leave the cluster when oauth2-proxy calls Google in step 4 of sign-in? (#150)
- How does the proxy check a Google ID token without asking Google on every request? (#150)
