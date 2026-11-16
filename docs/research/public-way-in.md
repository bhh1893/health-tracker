# Research: public way in to a home cluster

Facts for [Public way in to a home cluster](https://github.com/bhh1893/health-tracker/issues/171), on the map [Health Tracker v1: public access](https://github.com/bhh1893/health-tracker/issues/170). Facts only; the choice belongs to a later grilling ticket.

Setting: k3s behind a home router with no port-forwarding, Cilium Gateway API Gateway in `edge` with a cert-manager Let's Encrypt certificate (ADR 0020), served at `health.nibblejiggle.xyz`, DNS on free Cloudflare, no Tailscale on the public path, $0/month. Checked 2026-11-15.

## Summary

- Cloudflare Tunnel is "Available on all plans" and is the only free outbound tunnel found that serves a custom domain. ngrok Free and Tailscale Funnel do not.
- TLS from the browser ends at Cloudflare's edge, so Cloudflare sees every request in plaintext, including the session cookie and the OIDC callback code. Cloudflare to `cloudflared` is a separate encrypted tunnel; `cloudflared` to the Gateway is whatever the route's Service URL says (`http://` or `https://`).
- The zone SSL/TLS mode (Full, Full (strict)) does not govern tunnel traffic. `cloudflared` itself verifies an HTTPS origin, and the existing Let's Encrypt certificate on the Gateway already passes that check with no Cloudflare Origin CA certificate.
- The credential is one tunnel token (account tag, tunnel ID, tunnel secret). It is static until rotated, so a rebuild reuses it: it fits ADR 0015's dev-VM secret files.
- Limits that matter: 100 MB request body, 125 s proxy read timeout (`524`), 128 KB request headers, 25 replicas per tunnel. Terms bar serving video or a "disproportionate" share of large files on the free CDN; a form-and-JSON app is not that.
- Client IP arrives as `CF-Connecting-IP`; `X-Forwarded-For` is appended to, not overwritten. Cilium's Gateway trusts zero XFF hops by default.

## Cloudflare Tunnel: how it works

- `cloudflared` makes outbound-only connections, so no public IP or inbound firewall rule is needed. Each instance opens four long-lived connections to at least two Cloudflare data centers, on port `7844` (QUIC over UDP or HTTP/2 over TCP). Port 443 outbound is optional (auto-update, Access JWT validation). [Tunnel overview](https://developers.cloudflare.com/tunnel/), [Configuration](https://developers.cloudflare.com/tunnel/configuration/)
- A tunnel is a persistent object with a UUID; many `cloudflared` replicas can serve one tunnel (max 25). Replicas are for availability, not load balancing: "Traffic routes to the geographically closest replica." [Configuration](https://developers.cloudflare.com/tunnel/configuration/), [Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)
- **Plan:** "Available on all plans." [Tunnel overview](https://developers.cloudflare.com/tunnel/). Account limits: 1,000 tunnels, 25 active replicas per tunnel, published applications per tunnel bounded by a 1 MB config. [Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/)
- **DNS:** adding a published application creates a CNAME `health` -> `<UUID>.cfargotunnel.com`. "The `cfargotunnel.com` subdomain only proxies traffic for DNS records in the same Cloudflare account," so the zone must be on that Cloudflare account. The record survives the tunnel stopping. [Routing](https://developers.cloudflare.com/tunnel/concepts/routing/)
- **Origin types:** HTTP, HTTPS (with optional verification bypass), Unix socket, TCP/SSH/RDP/SMB (client-side `cloudflared` needed), HTTP_STATUS. [Routing](https://developers.cloudflare.com/tunnel/concepts/routing/)
- **WebSockets** are available on all plans. [Network settings](https://developers.cloudflare.com/network/)

## Terms: what traffic may be proxied

- Service-Specific Terms, "Content Delivery Network (Free, Pro, or Business)": non-Enterprise customers must use paid services (Stream, Images, Developer Platform) "to serve video and other large files via the CDN", and Cloudflare may limit or disable the CDN if used "to serve video or a disproportionate percentage of pictures, audio files, or other large files." [Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-application-services/)
- The terms page has no Tunnel-specific clause. A tunnel's public hostname is a proxied record, so the CDN clause is the one that applies (inference: tunnel hostnames "proxy traffic through Cloudflare", [Routing](https://developers.cloudflare.com/tunnel/concepts/routing/)).
- Health Tracker serves an SPA bundle and JSON, which this clause does not restrict.

## Routing to the Gateway API Gateway

- In Kubernetes the route's Service URL is an in-cluster Service name (Cloudflare's guide uses `http://httpbin-service`). [Kubernetes guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/deployment-guides/kubernetes/) Here that is the Service Cilium generates for the Gateway, for example `https://cilium-gateway-<name>.edge.svc.cluster.local`.
- `cloudflared` keeps the visitor's Host header unless `httpHostHeader` is set. [Origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/origin-parameters/) Gateway API selects an `HTTPRoute` by Host header and requires listener and route hostnames to intersect ([`httproute_types.go`](https://github.com/kubernetes-sigs/gateway-api/blob/main/apis/v1/httproute_types.go)), so the existing `hostname: health.nibblejiggle.xyz` listener and routes match unchanged.
- **HTTPS origin (Gateway `:443`):** `cloudflared` validates the origin certificate. With `originServerName` empty it expects the certificate to cover the Service URL's host, which a Service DNS name will not, so set `originServerName: health.nibblejiggle.xyz` (it also sets SNI, which the Gateway listener needs to pick its certificate). Leave `caPool` empty for a Let's Encrypt certificate. `noTLSVerify: true` is "a temporary last resort." [HTTPS origins](https://developers.cloudflare.com/tunnel/troubleshooting/https-origins/), [Origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/origin-parameters/)
- **HTTP origin (Gateway `:80`):** ADR 0020 makes `:80` redirect to HTTPS. A tunnel pointed at `http://` would hit that redirect, and the browser, already on HTTPS, would loop. Plain HTTP needs the redirect removed or a separate non-redirecting listener, and the leg from `cloudflared` to Envoy is then cleartext inside the cluster (pod to pod, covered by Cilium WireGuard only between nodes, ADR 0010).
- **Deployment:** Cloudflare recommends a separate `cloudflared` Deployment (`replicas: 2` in the guide), token from a Secret as `TUNNEL_TOKEN`, args `tunnel --no-autoupdate --metrics 0.0.0.0:2000 run`, liveness probe on `/ready` (200 only with an active connection to Cloudflare). Not for autoscaling: removing a replica drops its users' connections. [Kubernetes guide](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/deployment-guides/kubernetes/)
- **Helm:** `cloudflare/helm-charts` has `cloudflare-tunnel` and `cloudflare-tunnel-remote`; the last commit on its default branch is from September 2024 ([repo](https://github.com/cloudflare/helm-charts)). `cloudflared` itself is active (release `2026.11.0`, 2026-11-12). A plain Deployment manifest from the guide is the documented path.
- **Config location:** remotely managed (routes held by Cloudflare, set in dashboard, API or Terraform) or locally managed (a `config.yml` plus credentials file in the cluster). The Terraform provider (v5.29.0) has `cloudflare_zero_trust_tunnel_cloudflared`, `..._config`, `..._route` and `cloudflare_dns_record`. [Terraform provider docs](https://github.com/cloudflare/terraform-provider-cloudflare/tree/main/docs/resources)

## Where TLS ends and what Cloudflare can read

- Three legs: browser to Cloudflare edge (TLS with Cloudflare's edge certificate), edge to `cloudflared` (the tunnel's own post-quantum encrypted connection), `cloudflared` to Gateway (the route's Service URL). [Tunnel overview](https://developers.cloudflare.com/tunnel/), [HTTPS origins](https://developers.cloudflare.com/tunnel/troubleshooting/https-origins/)
- For proxied records TLS terminates at Cloudflare, and the edge certificate is what visitors see; WAF and other features work on the decrypted request. [Proxy status](https://developers.cloudflare.com/dns/proxy-status/), [Security reference architecture](https://developers.cloudflare.com/reference-architecture/architectures/security/). So Cloudflare can read every request and response: URLs, the `__Host-health_session` cookie, the OIDC `code` on `/oauth2/callback`, and logged data. This is a threat-model fact for the ADR 0015 amendment.
- **Edge certificate:** Universal SSL is on for Free zones and covers the apex and first-level subdomains, so `health.nibblejiggle.xyz` is covered; deeper names (`a.health...`) would need Total TLS or Advanced Certificate Manager. [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/)
- **Full vs Full (strict):** these modes describe how Cloudflare connects to a normal IP origin (Full: no validation; strict: public CA or Cloudflare Origin CA). [SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/) For tunnel routes, "The connection between Cloudflare and `cloudflared` is encrypted independently of the zone SSL/TLS mode" and the mode "does not ... fix a certificate mismatch between `cloudflared` and the origin." [HTTPS origins](https://developers.cloudflare.com/tunnel/troubleshooting/https-origins/) Consequence: no Cloudflare Origin CA certificate is needed; the existing cert-manager certificate is the origin certificate if the origin is HTTPS. Authenticated Origin Pulls "has no effect on tunnel-routed hostnames." [Cloudflare One Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- cert-manager DNS-01 keeps working: it writes `_acme-challenge` TXT records, unaffected by `health` changing from a DNS-only A record to a proxied CNAME (inference from ADR 0020's issuer setup).

## Credential and rebuilds

- A remotely managed tunnel "only requires a token to run," and "Anyone with the token can run the tunnel." [Tunnel tokens](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)
- The token is base64 JSON of account tag, tunnel secret and tunnel ID (`TunnelToken` in [`connection/connection.go`](https://github.com/cloudflare/cloudflared/blob/master/connection/connection.go)). Nothing in it is tied to a host or pod, so the same token works after a cluster rebuild until it is rotated. Store it in `~/.config/health-tracker/` and apply with `apply-secrets` like the other console-made values (ADR 0015).
- Get it from the dashboard or `GET /accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/token` (API token permission "Cloudflare Tunnel Write" or equivalent). [Tunnel tokens](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)
- **Rotation:** "Rotate token" in the dashboard; old token cannot open new connections, but "Existing connectors remain active until restarted." On compromise also `DELETE .../cfd_tunnel/$TUNNEL_ID/connections`. [Tunnel tokens](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)
- Unlike the Tailscale path (ADR 0020), a rebuild leaves nothing behind in Cloudflare: new pods reconnect to the same tunnel UUID. The DNS record and remote config live in the Cloudflare account, not the cluster.

## Failure behaviour

- No connector connected: visitors get error `1033` ("your tunnel is not connected to Cloudflare's network"). Connected but the origin unreachable: `502` "Unable to reach the origin service". [Troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/)
- Failed QUIC dials retry with backoff (2 to 64 s), then fall back to HTTP/2 over TCP. [Troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/) Losing one of four connections, a server or a data center leaves the app up. [Configuration](https://developers.cloudflare.com/tunnel/configuration/)
- Home connection down means `1033` for everyone (out of scope per the map).

## Request size and timeout limits (Free)

| Limit | Value | Source |
| --- | --- | --- |
| Request body | 100 MB, `413` above | [Error 413](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/) |
| Proxy read timeout (origin to first byte) | 125 s, `524`; configurable only on Enterprise | [Connection limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/) |
| Proxy write timeout | 30 s, `524` | same |
| Proxy idle timeout | 900 s, `520` | same |
| Client keep-alive / HTTP/2 idle | 400 s | same |
| URL length | 16 KB | same |
| Request headers / response headers | 128 KB each | same |
| Tunnel origin connect timeout | 30 s default (`connectTimeout`) | [Origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/origin-parameters/) |

For published applications the CDN timeouts and the tunnel's timeouts both apply; the shorter wins. [Origin parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/origin-parameters/) oauth2-proxy may split a large session across several cookies (ADR 0021), well under 128 KB.

## Client IP at the origin

- `CF-Connecting-IP`: the client IP connecting to Cloudflare. `X-Forwarded-For`: Cloudflare appends; a client-sent value is kept. `X-Forwarded-Proto`: set by Cloudflare, client value overwritten. `True-Client-IP`: Enterprise only. [HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- The TCP peer Envoy sees is the `cloudflared` pod. Cilium's `gatewayAPI.xffNumTrustedHops` defaults to `0` ("number of additional GatewayAPI proxy hops from the right side of the HTTP header to trust"). [Cilium values.yaml](https://github.com/cilium/cilium/blob/v1.18.0/install/kubernetes/cilium/values.yaml)
- Any per-client logic (rate limiting, logging) must read `CF-Connecting-IP` or set trusted hops correctly; the left-most XFF entry is client-controlled. Nothing stops an in-cluster pod from forging `CF-Connecting-IP` either, so it is trustworthy only on the tunnel path.

## Other free outbound tunnels with a custom domain

| Option | Custom domain on free? | Source |
| --- | --- | --- |
| Cloudflare Tunnel | Yes (zone on the same Cloudflare account) | above |
| ngrok Free | No: "Not included"; one ngrok development domain, 1 GB out, 20k requests | [ngrok pricing](https://ngrok.com/pricing) |
| Tailscale Funnel | No: "only use DNS names in your tailnet's domain (`tailnet-name.ts.net`)"; also excluded by the map | [Funnel](https://tailscale.com/kb/1223/funnel) |
| Self-hosted relays (frp, rathole, a WireGuard VPS) | Need a public host, which is not free or is out of scope (no VPS) | map out-of-scope |

## Open points for the grilling ticket

- **HTTPS or HTTP from `cloudflared` to the Gateway.** HTTPS keeps cert-manager and end-to-end encryption to Envoy, at the cost of `originServerName` config. HTTP drops the certificate but breaks the `:80` redirect and leaves an in-cluster cleartext hop.
- **Remote vs local tunnel config, and IaC.** Dashboard-managed routes drift from the repo; Terraform (`cloudflare_zero_trust_tunnel_cloudflared_*`) or a local `config.yml` keeps them in git. The repo applies the tailnet policy as code (#163); the same reasoning would apply here.
- **Where `cloudflared` runs and how it reaches the Gateway** (namespace, NetworkPolicy, two replicas on different nodes).
- **Accepting Cloudflare as a plaintext party** in the threat model, next to Google (sign-in) and the removed Tailscale path.
- **Client IP trust** for rate limiting and logs: `CF-Connecting-IP` vs `xffNumTrustedHops`, and whether the Gateway should reject traffic not from `cloudflared`.
- **Edge protection on Free** (WAF managed rules, rate limiting rules, Cloudflare Access free tier) was not researched here; it belongs to the edge protection ticket.
