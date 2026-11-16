# Request path: phone to database

One request, followed hop by hop from the phone to Postgres. It grows as the build tickets land: each ticket fills in the steps it builds.

Two separate questions are answered on the way:

1. **Can this device reach the server at all?** The network: DNS, Tailscale, Cilium. Asked on every request.
2. **Who is this person?** Identity: Google and oauth2-proxy. Google is asked once at sign-in, then not again for 30 days.

Google never talks to the tailnet. The phone carries messages between Google and the proxy by following redirects.

## How to use this doc

- Each step has four parts: **What** it is, what it **Decides**, how to **Watch** it happen, and how it **Fails**.
- Steps not built yet are marked with the ticket that builds them. Fill in Watch and Fails during that ticket, from what you actually saw.
- Questions go in [Open questions](#open-questions). Move each one into a step once it is answered.
- Self-test after each ticket: draw the whole path on a blank page from memory, then compare.

## The map

```text
                                     every request
phone ──1 DNS──> 100.x ──2 WireGuard tunnel──> 3 ProxyGroup pod ──> 4 Gateway (Envoy, TLS ends)
                                                                          │ HTTPRoute by path
                                                       5 Service picks a ready pod
                                                                          │
                                         6 oauth2-proxy sidecar ──127.0.0.1──> 7 api ──> Postgres

                                     first visit only
phone <──redirect──> accounts.google.com            proxy ──code for tokens──> Google
```

| Step | Today (home Wi-Fi only) | Target | Built by |
| --- | --- | --- | --- |
| 1 DNS | none: the phone uses the raw IP `192.168.0.250` | Cloudflare hosts the zone (done, #146); `health` is a proxied CNAME to the tunnel, so it resolves to Cloudflare's edge | #146, #180 |
| 2 Reach | home LAN, a worker answers ARP for `.250` | Tailscale WireGuard tunnel to `100.x` | #144, #145 |
| 3 Into the cluster | the worker's bridged NIC | Tailscale ProxyGroup pod | #145, #147 removes the LAN |
| 4 Gateway | Envoy, HTTP on `:80` and HTTPS on `:443` with a Let's Encrypt certificate (#146) | HTTPS on `:443` only; TLS from `cloudflared` ends here, the browser's ended at Cloudflare | #146, #147 removes `:80` |
| 5 Service | same | same | - |
| 6 Sidecar | nginx checks a static Bearer token (`api` only) | oauth2-proxy checks a session cookie (`api` and `web`) | #150 |
| 7 `api` | every caller is the seeded User | caller's User from proxy headers, Pending gets `403` | #151 |

## Every request

### 1. DNS (zone moved in #146; record in #180)

- **What:** the phone turns `health.nibblejiggle.xyz` into an IP address. Its resolver asks the root servers, then the `.xyz` registry (which says "ask `jamie` and `luke.ns.cloudflare.com`", the delegation Porkbun set), then Cloudflare's nameservers.
- **Decides:** where the phone connects. With a proxied (orange cloud) record, Cloudflare answers with its own edge addresses, never the home's, so every request lands at Cloudflare first (ADR 0025).
- **Built in #146:** Cloudflare hosts the zone; Porkbun stays the registrar. DNSSEC is on: the registry holds a DS record (key tag `2371`) vouching for the key Cloudflare signs answers with, so a forged answer fails validation. The zone has no `health` record yet; the tunnel ticket adds it with Terraform.
- **Watch:**
  - `dig +noall +authority NS nibblejiggle.xyz @x.nic.xyz` (the delegation at the registry)
  - `delv @1.1.1.1 nibblejiggle.xyz SOA` (`; fully validated`: the DNSSEC chain holds)
  - `dig +short health.nibblejiggle.xyz @1.1.1.1` (empty until #180; then Cloudflare addresses)
  - `docs/runbooks/cloudflare.md` for how it was set up
- **Fails:**
  - No record: `NXDOMAIN`, the browser says the site cannot be found. True today, until #180.
  - DS record not matching Cloudflare's key: `SERVFAIL` from validating resolvers such as `1.1.1.1` and `8.8.8.8`, so the name stops resolving for everyone using one, all at once. Fix by deleting the DS record at Porkbun first.
  - Right after a nameserver change, resolvers can serve the old answer for up to the registry's TTL, 3600 s.

### 2. Reaching the tailnet (built in #144, #145)

- **What:** the phone's Tailscale app sees a tailnet address and sends the packet into an encrypted WireGuard tunnel instead of out over Wi-Fi or cellular.
- **Decides:** whether this device may reach `svc:health` at all. The tailnet policy (`iac/tailscale/policy.hujson`) allows members only `tcp:443` and `tcp:80` on it.
- **Watch:** fill in during #145.
- **Fails:** fill in during #145.

**Today:** the phone must be on home Wi-Fi. It asks the LAN "who has `192.168.0.250`?" (ARP). Cilium's L2 announcement makes one worker answer on its bridged NIC; the workers elect which one with a Kubernetes Lease (`k8s/platform/cilium/l2-announcement.yaml`).

### 3. Into the cluster (built in #145; LAN path removed in #147)

- **What:** the tunnel ends at the Tailscale ingress ProxyGroup pod, which owns the TailVIP and forwards the TCP connection to the Gateway's Service.
- **Decides:** nothing about the request; it is plumbing. It still sees only encrypted TLS bytes.
- **Watch:** fill in during #145.
- **Fails:** fill in during #145.

**Today:** packets for `.250` arrive on the announcing worker's bridged NIC, and Cilium's eBPF on that node takes over.

### 4. Gateway (HTTPS built in #146)

- **What:** the Gateway `edge` (`k8s/platform/edge/gateway.yaml`). Cilium turns it into a LoadBalancer Service and runs Envoy to serve it. eBPF on the node hands packets for the Gateway's address to Envoy.
- **Decides:** which backend gets the request, by path, using the `HTTPRoute`s that live with each service. Longest prefix wins: `/api` goes to the `api` Service (`services/api/k8s/httproute.yaml`), everything else to `web` (`services/web/k8s/httproute.yaml`). Routes name no hostname, so they attach to both listeners.
- **TLS ends here (#146):** the `https` listener on `:443` holds a Let's Encrypt certificate for `health.nibblejiggle.xyz` in Secret `edge/health-tls`. A client must send that name as SNI, or Envoy has no certificate to offer. Before this step the request is encrypted; after it, Envoy can read the path.
  - **Where the certificate comes from:** the Gateway's `cert-manager.io/cluster-issuer: letsencrypt-production` annotation makes cert-manager create a `Certificate`. It proves control with DNS-01: writes a `TXT` record at `_acme-challenge.health.nibblejiggle.xyz` through the Cloudflare API, Let's Encrypt looks it up, the record is deleted. The Gateway never needs to be reachable from the internet for this. Renewal is automatic at two thirds of the 90 days.
  - **Rebuilds:** `save-tls` keeps a copy on the dev VM, and `apply-secrets` restores it before the Gateway exists, so a rebuild issues nothing (Let's Encrypt allows 5 per name per 7 days).
  - **Target (ADR 0025):** TLS happens twice. The browser's TLS ends at Cloudflare's edge, with Cloudflare's certificate. `cloudflared` then opens a second TLS connection to this listener, sends `health.nibblejiggle.xyz` as SNI, and verifies this certificate. `:80` goes in #147.
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
  - Through the tunnel (#180), a broken certificate here shows as a Cloudflare `502`, not a browser warning: the browser only ever sees Cloudflare's certificate.

### 5. Service picks a pod (exists)

- **What:** the `api` Service (`services/api/k8s/service.yaml`) selects pods labelled `app.kubernetes.io/name: api`. Kubernetes keeps an EndpointSlice listing only the pods whose readiness probe passes. Envoy sends the request straight to one of those pod IPs.
- **Decides:** which `api` pod answers. There are two, one per worker.
- **Note:** if the chosen pod is on another node, Cilium encrypts node-to-node traffic with WireGuard (`encryption` in `k8s/platform/cilium/values.yaml`). This is Cilium's own WireGuard, separate from Tailscale's.
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
2. Tapping "Sign in with Google" hits `/oauth2/start`. The proxy sets a short-lived state cookie and redirects the phone to `accounts.google.com`. This leg goes over the normal internet, not the tailnet.
3. The person signs in at Google. Google redirects the phone to `https://health.nibblejiggle.xyz/oauth2/callback?code=...&state=...`. Google never connects to the cluster; the phone's browser follows the redirect, so a tailnet-only hostname works.
4. The proxy checks `state` against its cookie (proof this callback belongs to a sign-in it started), then calls Google directly, server to server, to trade the code for tokens using the client secret. The phone never sees a token.
5. The proxy verifies the ID token's signature and claims, sets the `__Host-health_session` cookie (encrypted with the cookie secret), and redirects back to the page originally asked for.
6. For 30 days, only the cookie matters. Google is out of the loop.

- **Watch:** fill in during #150. Use the browser's network tab with "Preserve log" on to see each redirect and cookie.
- **Fails:** fill in during #150.

## Open questions

- How does the phone's Tailscale app know `100.x` goes into the tunnel, and what is a DERP relay? (#145)
- What exactly does the ProxyGroup pod do with a packet, and why does it need its own Tailscale identity? (#145)
- Where does Cilium's Envoy run, and how does eBPF hand it a packet addressed to the Gateway? (now)
- How does Envoy choose between the two `api` pods? (now)
- How does traffic leave the cluster when oauth2-proxy calls Google in step 4 of sign-in? (#150)
- How does the proxy check a Google ID token without asking Google on every request? (#150)
