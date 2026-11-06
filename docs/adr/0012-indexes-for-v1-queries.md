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
- **Typeahead (non-empty `q`):** prefix `LIKE` on `lower(name)` OR the `<%` operator at `word_similarity >= 0.4`; prefix matches first, then score descending, then name. For `q` shorter than 3 characters, prefix only. The operator matters: only an operator can use the GIN index, a `word_similarity()` call in `WHERE` cannot.
- **Near-duplicate on create:** exact match via the existing unique `(user_id, lower(name))` index; near match is the `%` operator at `similarity >= 0.5` on the normalized name. Thresholds are set per query with `SET LOCAL`, never globally. Both numbers were tuned at build, see Threshold tuning.
- **Recently used (empty `q`) and `last_quantity`:** computed at read time, no stored column. One `LEFT JOIN LATERAL` per Catalog row finds its newest Entry in `(day, occurred_at)` order, through the food-filter and Exercise indexes; rows sort by that, and never-used items follow by name. The same subquery supplies `last_unit` and `last_quantity`. This visits every item in the user's Catalog rather than stopping at `limit`, which is simpler than scanning Entries and fine for Catalogs of hundreds of rows. Restaurants have no `(user_id, restaurant_id)` index and scan the user's Meals; the seed-script plans decide whether either needs more.

## Threshold tuning

Measured on Postgres 18 over the pairs in `services/api/tests/name_pairs.py`, which a test keeps true.

**Near-duplicate: changed from 0.6 to 0.5.** At 0.6 it missed real duplicates: `egg`/`eggs` (0.50), `oats`/`oat` (0.50), `pullup`/`pull up` (0.50), `rice`/`rices` (0.57), `kale`/`kales` (0.57). The two errors cost different amounts: a false alarm is one tap on a dialog when creating an item, while a missed duplicate splits one Food's history across two rows for good. So the threshold favours false alarms.

- Accepted false alarms at 0.5: `bench press`/`incline bench press` (0.60), `2% milk`/`1% milk` (0.56), `chicken breast`/`chicken` (0.53), `squat`/`front squat`, `apple`/`apple juice`, `deadlift`/`romanian deadlift` (all 0.50).
- Accepted miss: `chipotle`/`chipolte` (0.38). A swap of two letters breaks three trigrams; reaching it would also flag `chicken breast`/`chicken thigh` (0.38). Typeahead still shows the existing item while typing.

**Typeahead: 0.4 kept.** Typos score 0.50 to 0.63 (`chiken`, `brest`, `buter`). Noise such as `oat` for `goat cheese` (0.50) gets through, but ranks below every prefix match.

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
