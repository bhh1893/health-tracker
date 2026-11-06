---
status: accepted
---

# API contract: aggregate Meals, client-generated IDs, filtered collections

The v1 API is a JSON REST API under `/api/v1`, described by the generated OpenAPI schema (the client/server contract, ADR 0003). The Meal is written whole, every create is an idempotent `PUT` to a client-generated ID, and queries are filtered collections rather than special-purpose endpoints. Each endpoint has a stable `operationId` so a later Claude MCP wrapper is a mechanical mapping, one tool per operation.

## Shape

- **Resources:**
  - `PUT|GET|DELETE /meals/{id}`: the Meal is an aggregate, read and written whole: kind, label, `occurred_at`/`occurred_tz`, and either `food_entries[]` or `restaurant_id`. Adding or removing a Food Entry means the client resends the full Meal; there is no `/food-entries` resource.
  - `PUT|GET|DELETE /exercise-entries/{id}`: flat, one Set each.
  - `PUT|PATCH|GET|DELETE /foods/{id}`, and the same for `/exercises` and `/restaurants`: `PATCH` renames or archives. `DELETE` succeeds only for never-used items; otherwise `409` suggesting archive.
- **Writes:** the client generates the UUIDv7; the server rejects anything else. `PUT` returns `201` on create and `200` on replace, both with the full resource. A retried `PUT` or `DELETE` is harmless (`DELETE` of a missing row returns `204`). Last write wins; no `ETag`/`If-Match` in v1.
- **New Catalog items** are created in their own request before the Meal or Exercise Entry that uses them, so the near-duplicate dialog can interrupt.
- **Queries:**
  - `GET /meals?from=&to=&food_id=` and `GET /exercise-entries?from=&to=&exercise_id=`: `from`/`to` are Days, inclusive; one Day is `from = to`.
  - `GET /exercises/{id}/sessions?limit=N`: last N Sessions, each `{day, sets: [{number, reps, weight_lb}]}`.
  - No `/days/{day}` endpoint; the client makes two calls.
- **Reads embed** `{id, name, archived}` for every Catalog reference and include derived fields (`day`, Meal `number`, Set `number`). `occurred_at` is returned with the offset of its `occurred_tz`.
- **Pagination:** cursor (keyset on `day, occurred_at, id`) on the two range collections: `{items, next_cursor}`, `limit` default 50, max 200. Suggestions and sessions take `limit` only.
- **Suggestions (typeahead):** `GET /foods?q=&limit=10` (same for exercises and restaurants), called as the user types with a ~150 ms client debounce. `pg_trgm` ranking handles prefixes and typos, not fzf-style abbreviations. Archived items are excluded unless `include_archived=true`. Foods return `last_unit`.
- **Duplicates on create:** an exact case-insensitive match returns `409` with the existing item (the client offers unarchive if it is archived). A trigram near-match returns `409` with `similar[]`; the client resends with `allow_similar: true`. Renames through `PUT` or `PATCH` take the same checks, because a rename can create the same duplicate. Names are at most 200 characters after normalizing.
- **Validation:** `occurred_at` is RFC 3339 with an offset, at most 5 minutes in the future, no past bound. `occurred_tz` must be an IANA name known to Python `zoneinfo`, backed by the pinned `tzdata` package.
- **Errors:** RFC 9457 Problem Details (`application/problem+json`) with an `errors[]` extension for field errors, and `existing` and `similar[]` extensions on duplicates. A `409` carries a `type` URN (`urn:health-tracker:problem:exact-duplicate`, `near-duplicate`, `item-in-use`) so a client can branch without parsing `detail`. `422` invalid input, `404` missing or not yours, `409` conflicts (duplicates, last Food Entry, used Catalog item), `401` from the edge.
- **Identity:** implicit, the "/me" pattern. No `user_id` in paths or bodies; one `current_user` dependency scopes every query. v1 returns the seeded user.
- **Versioning:** `/api/v1` prefix. Within v1 only additive changes; a breaking change ships as `/api/v2` alongside v1.
- **MCP readiness:** hand-set `operationId` (`list_meals`, `put_meal`, `suggest_foods`, `get_exercise_sessions`, ...) and a one-line description per endpoint, enforced by a CI lint on `openapi.json`.
- **Health:** `/healthz` (liveness, no DB) and `/readyz` (DB reachable, migrations applied), outside `/api/v1` and not routed by the edge. "Applied" means the database is at or ahead of the image's latest revision: the migration Job runs before rollout (ADR 0016), so an old pod seeing a revision it does not know stays ready. Only a database behind the image, or unmigrated, fails.

## Considered Options

- **Separate `/food-entries` resource.** Rejected: "a Meal keeps at least one Food Entry" becomes a cross-request rule and partial saves become possible.
- **`POST` with server-generated IDs plus an `Idempotency-Key` header.** Rejected: needs a server-side key store with expiry for the same retry safety that `PUT` to a client ID gives for free.
- **`GET /days/{day}` aggregate read.** Rejected: a second read path over the same data that does not cover ranges.
- **Offset pagination.** Rejected: skips or repeats rows when data changes mid-scroll and slows on deep pages.
- **Separate `/similar` check before create.** Rejected: two round trips and a race between check and create.
- **Client-side fuzzy matching over the whole Catalog.** Not chosen: true subsequence matching and zero latency, but a second matcher the MCP wrapper would not share, and duplicate checks must stay on the server anyway. Can be added later without an API change.
- **FastAPI's default `{"detail": ...}` errors.** Rejected: a different shape for each kind of error.
- **No versioning.** Rejected: `web` and `api` deploy separately, and the MCP wrapper will be a second client.

## Consequences

- The client owns form state and always holds the whole Meal it is editing.
- Every write is retry-safe, which matters on phone Wi-Fi.
- Two devices editing the same Meal silently overwrite each other until `ETag`/`If-Match` is added (backward compatible).
- Breaking changes cost a parallel `/api/v2`; the OpenAPI drift check in CI is where they surface.
- The index design must serve keyset pagination on `(user_id, day, occurred_at, id)`, the Food/Exercise filters, last-N Sessions, and `pg_trgm` suggestions.
