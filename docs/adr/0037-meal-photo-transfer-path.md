---
status: accepted
---

# Meal Photo bytes travel through `api` both ways, never by presigned URL

Every Meal Photo upload and download goes phone -> Cloudflare -> tunnel -> Envoy -> oauth2-proxy -> `api` -> Garage, so each byte passes the session check, the ownership check and the per-User rate limits (ADR 0027). Garage stays off every network a phone can reach. Decided in [Upload and download path for Meal Photos](https://github.com/bhh1893/health-tracker/issues/297), on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Builds on ADR 0036. Facts behind it: [edge limits and caching research](https://github.com/bhh1893/health-tracker/blob/research/edge-limits-and-caching/docs/research/edge-limits-and-caching.md).

## Shape

- **Upload: one photo per request, raw body.** The body is the image bytes alone (`Content-Type: image/jpeg`), not `multipart/form-data`. `api` reads it into memory while counting bytes, since cloudflared sends chunked bodies that may carry no `Content-Length`, and answers `413` once the count passes the per-photo cap. The cap's value comes from [Meal Photo limits, quotas and threat model](https://github.com/bhh1893/health-tracker/issues/300). The client sends several photos as separate requests, at most 2 at a time, each with its own progress and ✕/retry.
- **Retries are safe.** The client picks each photo's UUID and uploads with `PUT`. A repeat with the same ID returns the photo already stored and never makes a second one. The exact URL and status codes belong to [Meal Photo data model, API and deletes](https://github.com/bhh1893/health-tracker/issues/299).
- **Download: streamed by `api`.** `GET` checks the session and ownership. Someone else's photo gets `404` "Missing, or not yours", as Meals do. `api` streams the object from Garage instead of loading it whole.
- **Never in Cloudflare's cache.** Photo URLs have no file extension, so Cloudflare's by-extension default does not apply. Responses carry `Cache-Control: private, max-age=31536000, immutable`: Cloudflare must not store them, and the phone's browser may keep them, because a photo ID's bytes never change (replacing a photo makes a new ID). A Terraform Cache Rule bypasses the cache for `/api/*` as a second layer. A thumbnail, if [Processing a Meal Photo](https://github.com/bhh1893/health-tracker/issues/298) adds one, follows the same rules.
- **S3 client: `boto3`,** with endpoint, bucket and key from env vars. If Garage rejects its default request checksums, `request_checksum_calculation="when_required"` goes in config, with no code branch per provider.
- **Timeouts unchanged.** Envoy's 15 s route timeout starts after the body has fully arrived, so it bounds processing plus the response. oauth2-proxy's 30 s and Cloudflare's limits stay at their defaults. An HTTPRoute `timeouts.request` is the fix if measurement says otherwise.
- **`api` -> Garage is plain HTTP on the host-only network,** the same hop `cnpg-backup` uses (ADR 0011). SigV4 stops forgery and replay, but someone on that network could read the bytes. `api` gets a CiliumNetworkPolicy egress rule to exactly Garage's host and port. The exposure goes to the threat-model ticket. Cloud S3 endpoints are HTTPS, so a move closes it with a URL change.

## Considered Options

- **Presigned URLs (browser to storage directly).** The usual choice at scale, since app servers stop carrying file bytes. Rejected for v1: unreachable as built (one tunnel hostname, cloudflared egress fenced, Garage on the host-only network). Reaching it would take a second tunnel route and an egress rule to a host outside the cluster, the routes ADR 0025 closed on purpose. It would also add a bearer-token surface with no rate limit (ADR 0027 lives in `api`) whose URLs leak through history and logs. And it is unconfirmed whether Garage enforces `content-length-range`, so a leaked PUT URL could fill the disk. Reopen it when moving to a cloud with a public object store. The API contract would not change.
- **Multipart upload.** Rejected: adds `python-multipart`, and Starlette spools file parts over 1 MB to a temp dir that `api`'s read-only root filesystem does not have. It buys nothing for one file per request.
- **Several photos per request.** Rejected: one dropped connection loses them all, and per-photo progress and retry get harder.
- **`POST` with an `Idempotency-Key` header.** Same guarantee as a client-chosen ID, plus a key to store. Rejected as the heavier version of the same idea.
- **`minio-py`.** Also a generic S3 client, but with fewer docs and community answers than `boto3`.
- **TLS on Garage now.** Rejected for v1: a cert to issue and rotate, protecting a network only the PC and the VMs are on.

## Consequences

- `api` carries every photo byte, so its 256Mi memory limit and CPU become photo-sized concerns. The per-photo cap and at most 2 parallel uploads per client bound one User. The limits ticket bounds the rest.
- **Verify at build:** `boto3` writes to Garage 2.5 with default checksums; a full-size photo downloads on cellular inside 15 s; a slow ~20 MB upload shows whether Cloudflare's 30 s write timeout is per write or per body; `curl -I` on a photo twice never shows `cf-cache-status: HIT`.
- A photo outage shows as `503` from `api`, and the client shows a placeholder (ADR 0036).
