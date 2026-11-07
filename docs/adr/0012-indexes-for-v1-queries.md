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
- **Recently used (empty `q`) and `last_quantity`:** computed at read time, no stored column. One `LEFT JOIN LATERAL` per Catalog row finds its newest Entry in `(day, occurred_at)` order, through the food-filter and Exercise indexes; rows sort by that, and never-used items follow by name. The same subquery supplies `last_unit` and `last_quantity`. This visits every item in the user's Catalog rather than stopping at `limit`, which is simpler than scanning Entries and fine for Catalogs of hundreds of rows. Restaurants have no `(user_id, restaurant_id)` index and scan the user's Meals. The seeded plans say neither needs more yet, see Verification.

## Threshold tuning

Measured on Postgres 18 over the pairs in `services/api/tests/name_pairs.py`, which a test keeps true.

**Near-duplicate: changed from 0.6 to 0.5.** At 0.6 it missed real duplicates: `egg`/`eggs` (0.50), `oats`/`oat` (0.50), `pullup`/`pull up` (0.50), `rice`/`rices` (0.57), `kale`/`kales` (0.57). The two errors cost different amounts: a false alarm is one tap on a dialog when creating an item, while a missed duplicate splits one Food's history across two rows for good. So the threshold favours false alarms.

- Accepted false alarms at 0.5: `bench press`/`incline bench press` (0.60), `2% milk`/`1% milk` (0.56), `chicken breast`/`chicken` (0.53), `squat`/`front squat`, `apple`/`apple juice`, `deadlift`/`romanian deadlift` (all 0.50).
- Accepted miss: `chipotle`/`chipolte` (0.38). A swap of two letters breaks three trigrams; reaching it would also flag `chicken breast`/`chicken thigh` (0.38). Typeahead still shows the existing item while typing.

**Typeahead: 0.4 kept.** Typos score 0.50 to 0.63 (`chiken`, `brest`, `buter`). Noise such as `oat` for `goat cheese` (0.50) gets through, but ranks below every prefix match.

## Verification

`services/api/tests/seed.py` generates 100 users x 3 years from a fixed random seed, at the real rates above: about 330k Meals, 1M Food Entries and 2.2M Sets. (This ADR first said 100k Meals and 700k Sets. Those totals are 100 users x 1 year.) `services/api/tests/test_index_plans.py` sends real requests and explains the SQL the API ran. Automated plan assertions are ADR 0014's; it runs them weekly.

Measured 2026-11-07 on Postgres 18.6, warm cache, summed over a request's statements. Timings are a record, not a target. Full plans are in [0012-plans.md](0012-plans.md).

| Query | Index that serves it | Execution |
| --- | --- | --- |
| Meals on a Day | `meals_user_day`, `food_entries_meal` | 0.15 ms |
| Meals newest first (page of 50) | `meals_user_day`, `food_entries_meal` | 2.1 ms |
| Meals next page | `meals_user_day`, `food_entries_meal` | 1.2 ms |
| Meals with a common Food | `food_entries_user_food` | 7.6 ms |
| Meals with a rare Food | `food_entries_user_food` | 0.19 ms |
| One Meal | a unique index on `meals (id, ...)`, `food_entries_meal` | 0.13 ms |
| Sets on a Day | `exercise_entries_user_day` | 0.21 ms |
| Sets newest first | `exercise_entries_user_day` | 1.2 ms |
| Sets next page | `exercise_entries_user_day` | 1.1 ms |
| Sets of an Exercise | `exercise_entries_user_exercise_day` | 3.9 ms |
| Last N Sessions | `exercise_entries_user_exercise_day` | 0.10 ms |
| Recent Foods | `food_entries_user_food` | 51 ms |
| Recent Exercises | `exercise_entries_user_exercise_day` | 0.48 ms |
| Recent Restaurants | `meals_user_day` | 43 ms |
| Foods typeahead | `foods_name_trgm` AND `foods_user_name_key` | 1.5 to 2.1 ms |
| Exercises typeahead | `exercises_user_name_key` | 0.25 ms |
| Restaurants typeahead | `restaurants_user_name_key` | 4.4 ms |
| Foods near-duplicate | `foods_name_trgm` AND `foods_user_name_key` | 4.6 ms |
| Exercises near-duplicate | `exercises_user_name_key` | 0.27 ms |
| Restaurants near-duplicate | `restaurants_user_name_key` | 0.13 ms |

No query reads an entry table sequentially. Plans held across 12 fresh `ANALYZE` samples, apart from how `exercises` joins in, which the checks do not assert.

- **Recency needs nothing more yet.** Recent Foods and Restaurants are the slowest queries, at about 50 ms, because they read each item's whole history. That runs when a ComboBox opens, not per keystroke, and is small next to a phone's network time. It grows with history, about 17 ms a year. Add the missing index or a bounded lookup if it reaches a few hundred ms.
- **Only Foods uses a trigram index.** `exercises_name_trgm` and `restaurants_name_trgm` are unused: `user_id` already narrows those Catalogs to 30 to 60 rows, and the GIN index cannot see `user_id`. More users will not change that, since each user's Catalog stays small while the trigram matches grow. The two indexes stay for now because they cost almost nothing at this write rate.

## Considered Options

- **GiST trigram index.** Rejected: its advantage is returning nearest matches in order (`ORDER BY name <-> q LIMIT 10`), which per-user Catalogs of hundreds of rows with `limit` 10 do not need; GIN looks up faster and also accelerates prefix `ILIKE`.
- **Copy `day` and `occurred_at` onto `food_entries`.** Rejected: breaks ADR 0002's derive-never-store rule and creates a sync bug when a Meal's time is edited.
- **`last_used_at` column on Catalog rows.** Rejected: deleting or editing the latest Entry forces a recompute, the sync bug ADR 0002 avoids.
- **`OFFSET` pagination.** Already rejected by ADR 0006; the Q2 indexes exist to make keyset cheap.

## Consequences

- Each index costs a little on every write; negligible at this write rate (a few dozen rows a day).
- Recency ordering uses `(day, occurred_at)` instead of raw `occurred_at`; they differ only for Entries logged across a timezone change. Accepted.
- Trigram search cannot use `user_id` inside the GIN index; at many users, the trigram match is selective enough that filtering afterwards is fine. The seeded plans bear this out: Foods combines the trigram index with `user_id`, so `btree_gin` is not needed.
- `pg_trgm` is a contrib extension: the Alembic migration runs `CREATE EXTENSION pg_trgm`, and the CNPG Postgres 18 image must ship contrib (the standard image does).
- Indexes land in the same migrations as their tables.
