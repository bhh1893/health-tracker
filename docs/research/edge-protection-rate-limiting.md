# Free-tier edge protection and in-cluster rate limiting

Research for [#172](https://github.com/bhh1893/health-tracker/issues/172) on the map [Health Tracker v1: public access](https://github.com/bhh1893/health-tracker/issues/170). Facts only, no decision. Read on 2026-11-15.

Versions this repo pins: Cilium 1.20.4 with Gateway API v1.6.3 (`k8s/platform/cilium/versions.yml`), which ships `cilium-envoy` built from Envoy v1.39.5 (`install/kubernetes/cilium/values.yaml` at tag `v1.20.4`).

## The path a request takes

Assumed public path: phone -> Cloudflare edge -> Cloudflare Tunnel -> `cloudflared` pod -> Cilium Gateway (Envoy) -> oauth2-proxy sidecar -> `api` (uvicorn on `127.0.0.1`). Each layer sees a different "client", which is the main thing to get right.

## Cloudflare, Free plan

### Does it apply to tunnelled traffic?

Yes. A tunnel hostname is a CNAME to `<id>.cfargotunnel.com`, and "Published applications inherit the Cloudflare settings for their hostname, including cache rules, WAF rules, and other Rules configurations." ([Tunnel DNS routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)). Rate limiting rules are part of the WAF product ([Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)).

### Rate limiting rules

From the availability table on [Rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/), Free column:

| Item | Free |
| --- | --- |
| Number of rules | 1 |
| Fields in the rule expression | Path, Verified Bot |
| Counting characteristics (the key) | IP |
| Custom counting expression | No |
| Counting model | Number of requests |
| Counting period | 10 s |
| Mitigation timeout | 10 s |
| Action behavior | Perform action during mitigation period (Throttle is Enterprise only) |
| Cache exclusion | No |

Client identity: Cloudflare counts by the visitor IP it sees at its own edge, before the tunnel, so the tunnel does not hide the client from this control.

### WAF custom rules

5 rules on Free, all actions except Log, no regex ([Custom rules](https://developers.cloudflare.com/waf/custom-rules/)). The page does not tie individual fields (country, ASN) to plans; not verified here.

### Managed WAF rules

Only the **Cloudflare Free Managed Ruleset** is available on Free; the full Managed Ruleset, OWASP Core Ruleset, Exposed Credentials Check and Sensitive Data Detection are not ([Managed rules](https://developers.cloudflare.com/waf/managed-rules/)). It "provides protection against high-impact and widely exploited vulnerabilities" and "is deployed by default on Free plans" ([WAF get started](https://developers.cloudflare.com/waf/get-started/)). Cloudflare's launch post says customers can disable the ruleset or individual rules ([WAF for everyone](https://blog.cloudflare.com/waf-for-everyone/)).

### Bot Fight Mode

Free. Challenges traffic matching known bot patterns across the whole domain ([Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)). Caveats from that page:

- "You cannot bypass or skip Bot Fight Mode using WAF custom rules or Page Rules." It cannot be scoped to some paths.
- It "may challenge API or mobile app traffic." Our `api` is called by the SPA's `fetch`, so a challenge there would surface as a failed request, not a page the user can solve. Not tested.
- It turns on JavaScript Detections, which cannot be disabled; a Content Security Policy must allow `/cdn-cgi/challenge-platform/`.
- An IP Access rule that matches first stops it from triggering.

### DDoS protection

"Available on all plans": "Standard, unmetered DDoS protection (layers 3-7)", including HTTP DDoS attack protection, applied automatically ([DDoS protection](https://developers.cloudflare.com/ddos-protection/)). A tunnel hostname is proxied through Cloudflare, so it sits behind this; the page itself does not mention tunnels.

### Headers Cloudflare sends to the origin

From [HTTP headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/):

- `CF-Connecting-IP`: the client IP that connected to Cloudflare. One value. Cloudflare recommends reading this (or `True-Client-IP`) instead of `X-Forwarded-For`.
- `X-Forwarded-For`: if the request had none, equals `CF-Connecting-IP`; if it had one, Cloudflare **appends** to it, so client-supplied entries stay in the list.
- `True-Client-IP`: Enterprise only.

Through a tunnel specifically, [cloudflared#1426](https://github.com/cloudflare/cloudflared/issues/1426) (open) shows a request sent with `X-Forwarded-For: a,b,c` reaching the origin as `Cf-Connecting-Ip: 203.0.113.1` and `X-Forwarded-For: a,b,c,203.0.113.1`. So the real IP is the rightmost XFF entry as it leaves `cloudflared`, and the leftmost entries are attacker-controlled.

## Cilium 1.20.4 Gateway (Envoy)

### Rate limiting

- Cilium's Gateway API does not expose rate limiting. The [Gateway API page](https://docs.cilium.io/en/v1.20/network/servicemesh/gateway-api/gateway-api/) lists no rate limiting feature, Gateway API v1.6.3 has no rate-limit resource in its standard channel, and the v1.20.4 HTTP connection manager translator adds only `grpc_web`, `grpc_stats`, `cors`, `ext_authz` and `router` filters (`operator/pkg/model/translation/envoy_http_connection_manager.go`).
- The `cilium-envoy` image pinned by 1.20.4 is built with `envoy.filters.http.local_ratelimit`, `envoy.filters.http.ratelimit` (global, needs a separate rate-limit service) and the network/listener local rate limit filters (`envoy_build_config/extensions_build_config.bzl` in `cilium/proxy` at the pinned commit `8c73b28`).
- The only way to add one is a hand-written `CiliumEnvoyConfig`. Cilium warns: "If you create CECs that conflict with or modify the autogenerated config, results may be unpredictable", CECs get minimal validation and have no defined conflict resolution ([L7 traffic management](https://docs.cilium.io/en/v1.20/network/servicemesh/l7-traffic-management/)). ADR 0010 already rejected hand-written CEC routes.

### What Envoy's local rate limit does (if added)

- Token bucket, configured globally or per route; empty bucket returns `429` ([local rate limit filter, v1.39.5](https://www.envoyproxy.io/docs/envoy/v1.39.5/configuration/http/http_filters/local_rate_limit_filter)).
- "By default the rate limits are applied per Envoy process." Cilium runs Envoy per node, so each node counts separately.
- Per-client buckets: a descriptor entry with the key set and the value omitted is a wildcard; Envoy keeps one bucket per distinct value in an LRU cache capped by `max_dynamic_descriptors` (default 20) ([proto, v1.39.5](https://github.com/envoyproxy/envoy/blob/v1.39.5/api/envoy/extensions/filters/http/local_ratelimit/v3/local_rate_limit.proto)).
- Keys come from route rate-limit actions: `remote_address` is "populated using the trusted address from x-forwarded-for"; `request_headers` can key on any header, for example `cf-connecting-ip` ([route_components.proto](https://www.envoyproxy.io/docs/envoy/v1.39.5/api-v3/config/route/v3/route_components.proto)).

### How Envoy identifies the client

- Cilium sets `use_remote_address: true` and `xff_num_trusted_hops: 0` by default (Helm `gatewayAPI.useRemoteAddress`, `gatewayAPI.xffNumTrustedHops`; [Gateway API page](https://docs.cilium.io/en/v1.20/network/servicemesh/gateway-api/gateway-api/)). Envoy appends the connecting peer to XFF.
- With those defaults the "trusted client address" is the immediate downstream connection, which behind a tunnel is the `cloudflared` pod. With `use_remote_address: true` and N trusted hops, it is "the Nth address from the right end of XFF" ([Envoy XFF headers](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_conn_man/headers#x-forwarded-for)). Given cloudflared#1426, `xffNumTrustedHops: 1` would make Envoy's trusted address the visitor IP Cloudflare appended. Inference, not tested.
- `CF-Connecting-IP` is passed through as an ordinary header. It is only trustworthy if every path into the Gateway goes through Cloudflare; today the Tailscale (`svc:health`) and LAN paths do not, and anyone on them could set it.

### Side finding: ExternalAuth is now implemented

ADR 0021 rejected Gateway `ExternalAuth` as "not implemented by Cilium's Gateway API support as far as we know". Cilium v1.20.4 does implement the HTTPRoute `ExternalAuth` filter (GEP-1494) as Envoy `ext_authz` (`HTTPExternalAuthFilter` in `operator/pkg/model/model.go`). Open bug: [cilium#49132](https://github.com/cilium/cilium/issues/49132), deleting a route with an ExternalAuth filter makes other routes on the same Gateway answer `403` on existing connections until drained (up to 600 s). Not relevant to rate limiting, but it changes a fact ADR 0021 relied on.

## oauth2-proxy

- No rate limiting option ([configuration overview](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview)).
- Client identification: `--reverse-proxy` (default `false`) enables reading a client-IP header; `--real-client-ip-header` (default `X-Real-IP`) accepts `X-Forwarded-For`, `X-Real-IP`, `X-ProxyUser-IP`, `X-Envoy-External-Address` or `CF-Connecting-IP`; `--trusted-proxy-ip` limits which peers may supply it, and if unset oauth2-proxy "trusts all source IPs for backwards compatibility". This affects its request and auth logs (`{{.Client}}`).
- Unauthenticated requests stop here (`401` for `/api/`, Sign-in page otherwise; ADR 0021), so `api` never counts anonymous traffic. Floods of unauthenticated requests only reach Cloudflare, Envoy and oauth2-proxy.

## FastAPI `api`

- **slowapi** ([docs](https://slowapi.readthedocs.io/en/latest/), [repo](https://github.com/laurentS/slowapi)): Starlette/FastAPI port of flask-limiter on top of the [`limits`](https://github.com/alisaifee/limits) library. Latest release v0.1.10 (2026-06-13), repo active. Self-described "alpha quality". Every limited endpoint must take an explicit `request: Request`; decorator order matters; storage is memory, Redis or memcached.
- **Per-User key:** `Limiter(key_func=...)` takes any function of the request. `get_remote_address` returns `request.client.host` (`slowapi/util.py`). A per-User key would read the identity header oauth2-proxy sets (issuer + `sub`, ADR 0021), which the proxy overwrites, so it is not spoofable from outside the pod.
- **Memory storage is per process.** `api` runs 2 replicas (`services/api/k8s/deployment.yaml`), so an in-memory limit of N lets a User make up to 2N requests. A shared count needs Redis or memcached, which is a new stateful service.
- **What `request.client.host` is:** uvicorn's `--proxy-headers` is on by default and trusts XFF only from `--forwarded-allow-ips`, default `127.0.0.1` and `::1` ([uvicorn settings](https://uvicorn.dev/settings/)). oauth2-proxy connects from `127.0.0.1`, so uvicorn will take an address from XFF. Which entry depends on what oauth2-proxy forwards; with only loopback trusted it should be an in-cluster address, not the visitor. Verify at build.

## Summary: how each control sees the client

| Control | Free / $0 | Client key behind the tunnel |
| --- | --- | --- |
| Cloudflare rate limiting rule | 1 rule, Path match, 10 s window | Visitor IP at Cloudflare's edge |
| Cloudflare Free Managed Ruleset | On by default | n/a (signature matching) |
| Bot Fight Mode | Whole domain, cannot skip | Cloudflare's own signals |
| Cloudflare DDoS (L3-7) | Automatic, unmetered | Cloudflare's own signals |
| Envoy local rate limit | Only via hand-written CEC | `cloudflared` pod by default; visitor IP with `xffNumTrustedHops: 1` or keyed on `cf-connecting-ip` |
| oauth2-proxy | No rate limiting | Logs only; header chosen by `--real-client-ip-header` |
| slowapi in `api` | Library, in-memory per pod | Any key; per-User from proxy identity headers |

## Open questions surfaced

- Bot Fight Mode cannot be skipped and may challenge `fetch` calls to `/api/`. Does it break the SPA, and is it worth turning on?
- Should ADR 0021 be revisited now that Cilium 1.20.4 implements `ExternalAuth`, given the open cilium#49132 bug?
- If any in-cluster control trusts `CF-Connecting-IP` or extra XFF hops, the Tailscale and LAN paths must be gone or must strip those headers first.
