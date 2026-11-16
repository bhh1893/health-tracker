---
status: accepted
---

# Rate limiting: one per-IP rule at Cloudflare on `/oauth2/`, one per-User limit in `api`

Two limits, each where the layer knows enough to apply it. Cloudflare sees the visitor IP but not who they are, so it guards the sign-in paths per IP. `api` sees only requests that already carry a session, so it limits per User. A request with no session never reaches `api`: oauth2-proxy answers it with the Sign-in page or `401` (ADR 0021). Decided in [Rate limiting tiers](https://github.com/bhh1893/health-tracker/issues/176), facts in [Free-tier edge protection and in-cluster rate limiting](https://github.com/bhh1893/health-tracker/issues/172). This amends ADR 0006 and follows from ADR 0025.

## Shape

### Edge (Cloudflare Free)

- **The one rate limiting rule** Free allows: path starts with `/oauth2/`, counted per IP, **20 requests per 10 s**, action Block for 10 s. A real sign-in is about 2 requests there (`/oauth2/start`, `/oauth2/callback`). It stops a script hammering `/oauth2/callback`, where each hit costs a server-side token call to Google. The blocked visitor gets Cloudflare's own `429` page; custom responses are a paid feature, and these are page navigations, so `web` never parses it.
- **Bot Fight Mode off.** It covers the whole domain, no rule can exempt a path, and its challenge is an HTML page the SPA's `fetch('/api/...')` cannot solve, so it would break the app for real Users with no clear error. Bots gain nothing past Google sign-in and Approval anyway.
- **Free Managed Ruleset on** (the default) and unmetered DDoS protection; neither challenges.
- **"Under Attack" mode** is a manual lever for an emergency only. ADR 0026's runbook custom rule on `/oauth2/start` is the other.
- The rule and these settings live in IaC with the zone (Terraform in `iac/cloudflare/`, ADR 0029), never in service code.

### `api`

- **One limit for every Role: 300 requests per minute per User, per pod**, moving window, reads and writes alike. A busy session is about 60 a minute (a dashboard load fires about 10), so 300 leaves 5x headroom and cuts a runaway loop at 100 requests/s within about 3 s. Pending is still restricted to `GET /api/me` by authorization (ADR 0021); the limit applies on top.
- **Keyed on the identity headers** oauth2-proxy sets and overwrites (`(issuer, sub)`), **checked before the database lookup**, so a throttled request never touches Postgres.
- **slowapi**, counters in each pod's memory. With 2 replicas the real ceiling is up to 600 a minute. Accepted: the limit guards against runaways and a stolen session, not exact quotas.
- **Configured by env var** (e.g. `RATE_LIMIT=300/minute`), so changing it is a manifest change, not a code change.
- **Exempt:** `/healthz` and `/readyz`. They carry no identity (ADR 0010), and a shared anonymous bucket could be exhausted and fail the probes.
- **No IP-based limit in `api`:** every request there has an identity. `CF-Connecting-IP` (ADR 0025) is for logs only.

### What a limited client sees (amends ADR 0006)

- `api` answers `429` as a Problem (`application/problem+json`) with type `urn:health-tracker:problem:rate-limited` and a `Retry-After` header in seconds. The contract lists `429` on every operation.
- `web` keeps its rule of never retrying a `4xx` and shows "Too many requests. Wait a moment and try again." through its existing error path.

### Seeing it

- `api` logs every `429` at warning level with the User id and `CF-Connecting-IP`. Edge blocks appear in Cloudflare's Security Events. No metrics or alerts in v1.

## Considered Options

- **Separate tiers per Role** (Pending limited by authorization only, a loose rate for approved Users). Rejected: one limit keyed on identity covers both with less to reason about.
- **Edge rule on `/` (everything).** Rejected: it would count a real User's `/api/` bursts per IP and block them, while anonymous `/` is a cheap static page.
- **Rate limiting at the Cilium Gateway.** Rejected: only through a hand-written `CiliumEnvoyConfig`, and Envoy's local limit counts per Envoy process, so per node.
- **Shared counters in Redis.** Rejected: one more stateful service to run and back up to make a safety limit exact.
- **Fixed window.** Rejected: it resets on the minute, so up to 2x can pass across the boundary. The moving window counts the last 60 s at every request.
- **A stricter, separate write limit.** Rejected for now: one number is easier to reason about; [Public threat model](https://github.com/bhh1893/health-tracker/issues/179) can revisit a Member filling the database.
- **Bot Fight Mode on.** Rejected, above.

## Consequences

- **Amends ADR 0006:** `429` with Problem type `urn:health-tracker:problem:rate-limited` and `Retry-After` on every operation.
- With 2 `api` replicas the effective limit is up to twice the configured one; scaling replicas raises it further.
- A User throttled by one pod may succeed on the other. Fine for a safety limit; wrong for anything billed or quota-like.
- The edge rule uses the only rate limiting rule Free allows. Another per-IP limit at the edge means a paid plan or a custom rule (5 on Free).
- **Verify at build:** which actions Free allows on the rate limiting rule; 21 requests to `/oauth2/start` from one IP within 10 s get a `429`; the SPA works with Bot Fight Mode off and the Free Managed Ruleset on; the 301st request in a minute from one User to one pod gets the `429` Problem with `Retry-After`, and Postgres sees no query for it; probes are never limited.
