---
status: accepted
---

# Indexes for v1 queries: one btree per query shape, GIN trigrams, computed recency

Every v1 query gets exactly one btree whose column order matches its `WHERE` and `ORDER BY`, Catalog names get GIN trigram indexes, and "recently used" is computed at read time rather than stored ([Indexes for v1 queries](https://github.com/bhh1893/health-tracker/issues/24)). This completes the index list ADR 0002 deferred and serves the queries of ADR 0006 and the additive ones of ADR 0008.

At one user's real volume (about 1,100 Meals and 7,000 Sets a year) Postgres reads a whole table in under a millisecond and the planner correctly ignores indexes. They are justified by multi-user readiness (ADR 0002) and verified on synthetic data, not on real data.

## Shape

- **Range feeds (keyset):** `meals (user_id, day, occurred_at, id)` and `exercise_entries (user_id, day, occurred_at, id)`, all ascending; newest-first reads the same index backwards. No separate `(user_id, day)` index (it is a prefix).
- **Foreign-key child:** `food_entries (meal_id)`, for loading a Meal's Food Entries and the cascade on Meal delete (Postgres does not index foreign keys itself).
- **Exercise filter and last-N Sessions:** `exercise_entries (user_id, exercise_id, day, occurred_at, id)`. The filtered range is a contiguous slice; last N Sessions reads it backwards collecting distinct `day` values and stops after N, then fetches those Days' Sets.
- **Food filter:** `food_entries (user_id, food_id) INCLUDE (meal_id)`, then a primary-key join to `meals` and an in-memory sort by `(day, occurred_at, id)`. No `day`/`occurred_at` copied onto `food_entries`.
- **Trigrams:** GIN with `gin_trgm_ops` on `lower(name)` for `foods`, `exercises` and `restaurants`. `user_id` and `archived_at IS NULL` are filters applied after the index lookup; no partial index.
- **Typeahead (non-empty `q`):** `ILIKE 'q%'` OR `word_similarity >= 0.4`; prefix matches first, then score descending, then name. For `q` shorter than 3 characters, prefix only.
- **Near-duplicate on create:** exact match via the existing unique `(user_id, lower(name))` index; near match is `similarity >= 0.6` on the normalized name. Thresholds are set per query with `SET LOCAL`, never globally. Both numbers are starting values, tuned on a fixture list of name pairs recorded in this ADR at build.
- **Recently used (empty `q`) and `last_quantity`:** computed at read time, no stored column. Scan recent Entries newest-first in `(day, occurred_at)` order, take distinct items until `limit`, pad with never-used items by name using the unique name index. `last_quantity` is the newest Food Entry per Food via the food-filter index.

## Verification

A deterministic seed script in `services/api/` (fixed random seed) generates 100 users x 3 years: about 100k Meals, 300k Food Entries, 700k Sets. For each v1 query we run `EXPLAIN (ANALYZE, BUFFERS)` and record the plan and timing in this ADR. Automated plan assertions in CI belong to the testing-strategy decision, not here.

## Considered Options

- **GiST trigram index.** Rejected: its advantage is returning nearest matches in order (`ORDER BY name <-> q LIMIT 10`), which per-user Catalogs of hundreds of rows with `limit` 10 do not need; GIN looks up faster and also accelerates prefix `ILIKE`.
- **Copy `day` and `occurred_at` onto `food_entries`.** Rejected: breaks ADR 0002's derive-never-store rule and creates a sync bug when a Meal's time is edited.
- **`last_used_at` column on Catalog rows.** Rejected: deleting or editing the latest Entry forces a recompute, the sync bug ADR 0002 avoids.
- **`OFFSET` pagination.** Already rejected by ADR 0006; the Q2 indexes exist to make keyset cheap.

## Consequences

- Each index costs a little on every write; negligible at this write rate (a few dozen rows a day).
- Recency ordering uses `(day, occurred_at)` instead of raw `occurred_at`; they differ only for Entries logged across a timezone change. Accepted.
- Trigram search cannot use `user_id` inside the GIN index; at many users, the trigram match is selective enough that filtering afterwards is fine. Revisit with `btree_gin` if plans on the seeded data say otherwise.
- `pg_trgm` is a contrib extension: the Alembic migration runs `CREATE EXTENSION pg_trgm`, and the CNPG Postgres 18 image must ship contrib (the standard image does).
- Indexes land in the same migrations as their tables; the seed script and recorded plans are build-phase work.
