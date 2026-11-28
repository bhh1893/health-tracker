# Edge limits and caching for uploads and private images

Research for [#295](https://github.com/bhh1893/health-tracker/issues/295) on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Feeds [Upload and download path for Meal Photos](https://github.com/bhh1893/health-tracker/issues/297). Facts and current config only; the design is #297's call.

Researched 2026-11-27 against the versions pinned on `main` at `dbae354`. Vendor pages are cited with the `dateModified` they showed that day.

## The path a photo would travel

```
phone -> Cloudflare edge (Free plan, TLS 1 ends, cache lives here)
      -> Cloudflare Tunnel -> cloudflared 2026.11.0 (pod in `edge`)
      -> Envoy, run by Cilium 1.20.4 for Gateway `edge` (TLS 2 ends)
      -> HTTPRoute `api` (/api) or `web` (/)
      -> oauth2-proxy v7.15.6 sidecar on :8080
      -> uvicorn 0.54.0 + Starlette 1.10.0 / FastAPI 0.162.0 (`api`)
         or nginx 1.30.6 (`web`, static files only)
```

There is no nginx ingress. The "ingress" is the Cilium Gateway (Envoy). The only nginx is inside the `web` pod, and an upload to `/api/...` never passes through it.

Sources in the repo: `iac/cloudflare/tunnel.tf`, `k8s/platform/edge/gateway.yaml`, `k8s/platform/cilium/versions.yml`, `k8s/platform/edge/cloudflared/deployment.yaml`, `k8s/components/auth-proxy/sidecar.yaml`, `services/api/uv.lock`, `services/web/Dockerfile`, ADR 0025 "Shape".

## 1. Body size limits and timeouts, hop by hop

| Hop | Body size limit | Timeouts that can hit an upload or download | What the repo sets |
| --- | --- | --- | --- |
| Cloudflare edge, Free | **100 MB**, over it `413` [1] | Proxy read timeout **125 s** to the first response byte after the origin ACKs, `524`, Enterprise-only to change [2][3]. Proxy write timeout **30 s**, `524`, not adjustable [2][3]. Proxy idle **900 s** [2]. URL max 16 KB, headers max 128 KB [2] | Nothing about size or timeouts. ADR 0025 Consequences already records 100 MB / 125 s |
| Cloudflare Tunnel / cloudflared | None documented [4] | `connectTimeout` 30 s, `tlsTimeout` 10 s, `keepAliveTimeout` 1m30s; no per-request HTTP timeout at the tunnel layer. For published apps "both the CDN and Tunnel timeouts apply, and the shorter one takes precedence" [2][4]. `disableChunkedEncoding` defaults `false`, so cloudflared sends bodies chunked over HTTP/1.1 [4] | Only `origin_server_name` (`iac/cloudflare/tunnel.tf:28`); all else default |
| Envoy (Cilium Gateway) | No body size setting in Cilium's Helm values [5]; none in the generated config | **Route timeout 15 s**, Envoy's default when unset [6]. Cilium leaves it unset when the HTTPRoute has no `timeouts` (it only disables `max_stream_duration`) [7]. The timer runs from "the point at which the entire downstream request (i.e. end-of-stream) has been processed" until "the upstream response has been completely processed" [6], so upload time does not count, but server processing plus streaming the whole response back does. Stream idle **300 s**, connect **2 s**, upstream idle **60 s** [5] | No `timeouts` on either HTTPRoute (`services/api/k8s/httproute.yaml:12`), no Envoy Helm overrides (`k8s/platform/cilium/values.yaml:22`) |
| oauth2-proxy v7.15.6 | None: no body limit in docs [8]; the server sets only `ReadHeaderTimeout: time.Minute` [9] | Upstream `timeout` default **30 s** [8], implemented as Go's `Transport.ResponseHeaderTimeout` [10], which counts from after the request body is fully written to the upstream until response headers arrive. Response streamed with `flushInterval` 1 s [8] | Defaults (`k8s/components/auth-proxy/alpha-config.yaml:20`) |
| uvicorn 0.54.0 (`api`) | None. Only `--h11-max-incomplete-event-size` 16 KB, which bounds headers, not the body [11] | `--timeout-keep-alive` 5 s (idle connections only) [11]. No request read timeout setting exists [11] | `CMD` with defaults (`services/api/Dockerfile:37`); `h11` is the only HTTP implementation installed (`uv.lock`) |
| Starlette 1.10.0 multipart (`api`) | No total body limit. Per request: `max_files` 1000, `max_fields` 1000, `max_part_size` 1 MB, but `max_part_size` applies to non-file fields only; a file part is unbounded [12] | n/a | Not used yet. `python-multipart` is not a dependency, and Starlette needs it to parse `multipart/form-data` |
| nginx (`web`) | `client_max_body_size` default 1 MB, but no upload goes to `web` | n/a | `services/web/nginx.conf` |

### What this means for an upload (implications, not decisions)

- **The effective cap today is 100 MB, set by Cloudflare.** Nothing in the cluster rejects a big body. A per-photo limit has to be enforced by `api` itself (check `Content-Length`, then count bytes while reading, since chunked bodies from cloudflared [4] may carry no `Content-Length`).
- **Starlette spills file parts to disk.** Each file is a `SpooledTemporaryFile(max_size=1 MB)` [12]: past 1 MB it is written to the temp dir. The `api` container runs `readOnlyRootFilesystem: true` with no `/tmp` volume (`services/api/k8s/deployment.yaml:85`), so a multipart photo over 1 MB would fail to spool until an `emptyDir` (with a `sizeLimit`) is mounted, or the body is streamed straight to storage. Memory limit is 256Mi (`deployment.yaml:82`).
- **15 s at Envoy is the tightest server-side clock.** For an upload it bounds "body fully received -> response fully sent", which is small. For a download it bounds the whole response transfer from `api` to Envoy. Envoy streams with flow control, so a large image over a slow link could in principle push the transfer past 15 s. Not measured; see "Verify at build". An HTTPRoute `timeouts.request` raises it per route [7].
- **30 s write timeout at Cloudflare** is "fixed" [3]; the docs do not say whether it measures one write or the whole body. With photos of a few MB and the home connection's downlink it is unlikely to matter, but it is the first limit a slow upload would meet after the body leaves the phone.
- Free plan gives no knob for any Cloudflare limit; the docs' answer for big or slow requests is a DNS-only (grey cloud) name [3], which this repo cannot use (no inbound port, ADR 0025).

## 2. Does Cloudflare cache images by default?

**Yes, by file extension.** "Cloudflare only caches based on file extension and not by MIME type" [13]. The default list includes `JPG`, `JPEG`, `PNG`, `WEBP`, `AVIF`, `GIF`, `SVG`, `ICO`, `TIF`, `TIFF`, `BMP`; it does **not** include `HEIC` [13]. HTML and JSON are not cached by default [13].

So: `GET /api/v1/meals/123/photos/9` with `Content-Type: image/jpeg` is **not** cached by default (no extension). `GET /api/v1/photos/9.jpg` **is** eligible, whatever the content type.

**When an eligible response is cached:**

- Default edge TTL when the origin sends no `Cache-Control` or `Expires`: 200, 206 and 301 for 120 min; 302/303 for 20 min; 404/410 for 3 min; other statuses not cached [13]. So oauth2-proxy's `401`/`403` for a signed-out visitor is never cached.
- Not cached if `Cache-Control` is `private`, `no-store`, `no-cache` or `max-age=0`, if `Set-Cookie` is present, or for non-GET methods [13].
- **Origin Cache Control** is on, and cannot be turned off, on Free [14]. With it on: `private` -> Cloudflare "must not store the response"; `no-store` -> not cached; **`no-cache` -> cached but always revalidated** (this contradicts the default-behavior page's list above); `max-age=0` and `s-maxage=0` -> cached and revalidated [14]. `private` and `no-store` are the only two both pages agree keep a response out.
- `Authorization` on the request is not listed as preventing caching [13].

**Why this matters here:** the default cache key is the URL including the full query string, plus a few headers (Origin, method-override, forwarded-host). **Cookies are not in it** [15]. A cached response is served by Cloudflare without the request ever reaching oauth2-proxy. If one User's photo at a `.jpg` URL were cached, anyone who knew the URL would get it, signed in or not. The session check in ADR 0021 would be skipped entirely.

**Tools available on Free:**

- `Cache-Control: private, no-store` from `api` on every photo response. Origin Cache Control means Cloudflare honors it [14].
- Cache Rules: 10 on Free [16]; a rule can make a path "bypass cache". Owned by Terraform here (`iac/cloudflare/rules.tf` holds the rate limit and custom rulesets; no `http_request_cache_settings` ruleset exists yet).
- Cache Deception Armor: refuses to cache when the URL extension and `Content-Type` disagree; enabled through a cache rule; listed as available on all plans [15][17]. Origin `Cache-Control` and Edge Cache TTL rules override it [17].

**What the repo sets today:** no cache rules. `web`'s nginx sends `Cache-Control: public, max-age=31536000, immutable` on `/assets/` and `no-cache` on everything else (`services/web/nginx.conf:30-44`). The four public icons (`.png`, `.svg`) are on the default extension list, so Cloudflare caches them; they are public by design (ADR 0025 amendment 2026-11-25). `api` sets no `Cache-Control` on any route.

## 3. Could a presigned URL to storage be reached through the tunnel?

**No, not as configured.** Three independent things stop it:

1. **One hostname, one target.** The tunnel has one route, `app.nibblejiggle.xyz` -> the Gateway Service, then a catch-all `http_status:404` (`iac/cloudflare/tunnel.tf:23-36`). A URL on any other name gets `404` from Cloudflare.
2. **cloudflared egress is fenced.** Its CiliumNetworkPolicy allows DNS, `region{1,2}.v2.argotunnel.com:7844` and the `api`/`web` pods on `8080`, nothing else (`k8s/platform/edge/cloudflared/network-policy.yaml:27-76`).
3. **Garage is not on any reachable network.** It listens on `192.168.56.20:3900`, plain HTTP on the host-only network (`iac/ansible/roles/garage/defaults/main.yml:12`, ADR 0011), reachable from the Windows PC and the nodes, not from the phone.

A presigned URL is also bound to the host it was signed for: SigV4 signs the `host` header, so a URL signed for `192.168.56.20:3900` would not validate if requested through `app.nibblejiggle.xyz` without the proxy rewriting the request to match.

Garage itself supports what a presigned flow would need: presigned URLs, SigV4, `PostObject`, multipart upload and bucket CORS are listed as implemented; bucket policies and ACLs are not (Garage uses per-key-per-bucket permissions) [18]. That page was last updated 2022-05-25 and warns entries may be outdated; whether Garage 2.5.0 enforces POST policy conditions such as `content-length-range` was not confirmed (its source host refused automated fetches).

## 4. What exposing storage publicly would add to ADR 0030's threat model

ADR 0030 says to revisit the model for "a new way in (hostname, tunnel rule, unauthenticated route)" and "a new service or datastore". Exposing storage hits both. Facts that would shape that update:

- **A second unauthenticated surface.** Storage would answer requests that never pass oauth2-proxy. Authorization becomes "whoever holds the URL": AWS describes presigned URLs as "bearer tokens that grant access to those who possess them", usable "multiple times, up to the expiration" [19]. Revoking one early means revoking the signing key, which revokes every URL it signed [19].
- **URLs leak through more channels than cookies.** The credential sits in the query string, so it lands in browser history, Cloudflare logs (Cloudflare already reads all traffic, ADR 0030), and anything that logs URLs. AWS warns server logs' Request-URI "can contain credential information" [19]. ADR 0030's rule that logs carry the path template, never the filled-in path, would need to cover storage too.
- **Cache interaction.** A presigned GET for `....jpg?X-Amz-...` behind Cloudflare would be cache-eligible by extension [13], keyed on the full query string [15]; a cached copy can outlive the URL's expiry (AWS checks expiry "at the time of the HTTP request" [19]; Cloudflare would not ask) unless storage sends `private`/`no-store`.
- **Breaks fail-closed edge properties ADR 0025 chose on purpose:** a second tunnel route and a cloudflared egress rule to a host outside the cluster (Garage runs on the dev VM, not in a pod), the very kind of route the `http_status:404` catch-all and the egress fence exist to stop.
- **Garage was sized as a backup target.** Its key model is per key per bucket, with no bucket policies [18]; the `cnpg-backup` key and the `backups` bucket would share a daemon with a public-facing endpoint. A write-capable presigned PUT also hands disk-filling to anyone holding a URL unless size is enforced at storage, which is the open `content-length-range` question above.
- **No rate limiting there.** ADR 0027's per-User limits live in `api`; a request straight to storage bypasses them, and Free has one rate limiting rule, already used for `/oauth2/` [ADR 0027].

## Verify at build

- A multipart photo over 1 MB reaches `api` and spools (needs a writable temp dir).
- Time a ~5 MB image download from the phone on cellular through the full path; compare against Envoy's 15 s route timeout.
- Upload a ~20 MB body on a slow link to see whether Cloudflare's 30 s write timeout is per write or per body.
- After shipping, `curl -I` a photo URL twice and confirm `cf-cache-status` is `BYPASS` or `DYNAMIC`, never `HIT`.

## Sources

1. Cloudflare Workers, Limits, "Maximum request body size" by zone plan: https://developers.cloudflare.com/workers/platform/limits/
2. Cloudflare Fundamentals, Connection limits (2026-11-13): https://developers.cloudflare.com/fundamentals/reference/connection-limits/
3. Cloudflare Support, Error 524 (2026-07-23): https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/
4. Cloudflare Tunnel, Origin parameters (2026-04-17): https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/cloudflared-parameters/origin-parameters/
5. Cilium 1.20 Helm reference (`envoy.*`, `gatewayAPI.*`): https://docs.cilium.io/en/v1.20/helm-reference/
6. Envoy, `config.route.v3.RouteAction.timeout` and `MaxStreamDuration`: https://www.envoyproxy.io/docs/envoy/latest/api-v3/config/route/v3/route_components.proto
7. Cilium v1.20.4 source, `operator/pkg/model/translation/envoy_virtual_host.go` (`timeoutMutation`) and `operator/pkg/gateway-api/ingestion/gateway.go` (`toTimeout`): https://github.com/cilium/cilium/blob/v1.20.4/operator/pkg/model/translation/envoy_virtual_host.go
8. oauth2-proxy 7.15.x, Alpha configuration (`Upstream.timeout`, `flushInterval`) and Overview (`--upstream-timeout`): https://oauth2-proxy.github.io/oauth2-proxy/configuration/alpha-config , https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview
9. oauth2-proxy v7.15.6 source, `pkg/proxyhttp/server.go:260`: https://github.com/oauth2-proxy/oauth2-proxy/blob/v7.15.6/pkg/proxyhttp/server.go
10. oauth2-proxy v7.15.6 source, `pkg/upstream/http.go:140-142` and `pkg/apis/options/upstreams.go:15`: https://github.com/oauth2-proxy/oauth2-proxy/blob/v7.15.6/pkg/upstream/http.go
11. uvicorn 0.54.0, `docs/settings.md`: https://github.com/encode/uvicorn/blob/0.54.0/docs/settings.md
12. Starlette 1.10.0 source, `starlette/formparsers.py` (`MultiPartParser`, `spool_max_size`, `on_part_data`): https://github.com/encode/starlette/blob/1.10.0/starlette/formparsers.py
13. Cloudflare Cache, Default cache behavior (2026-09-14): https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
14. Cloudflare Cache, Origin Cache Control (2026-06-30): https://developers.cloudflare.com/cache/concepts/cache-control/
15. Cloudflare Cache, Cache keys: https://developers.cloudflare.com/cache/how-to/cache-keys/
16. Cloudflare Cache, Cache Rules (2026-08-14): https://developers.cloudflare.com/cache/how-to/cache-rules/
17. Cloudflare Cache, Cache Deception Armor (2026-05-06): https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/
18. Garage, S3 compatibility status (2022-05-25): https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/
19. AWS S3 User Guide, Download and upload objects with presigned URLs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
