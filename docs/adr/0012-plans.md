# ADR 0012: recorded plans

`EXPLAIN (ANALYZE, BUFFERS)` for every v1 query, from `uv run pytest -m index_plans` with `INDEX_PLANS_REPORT` set, on Postgres 18.6 with the full seed, measured on 2026-11-07 on the dev VM (4 cores, 3 GB). Each plan is a second run, so it reads a warm cache. The summary and what it means are in [ADR 0012](0012-indexes-for-v1-queries.md#verification).

## Meals on a Day

```sql
SELECT m.id, m.kind, m.label, m.occurred_at, m.occurred_tz, m.day,
       (
           SELECT count(*) FROM meals n
           WHERE n.user_id = m.user_id AND n.day = m.day
             AND (n.occurred_at, n.id) <= (m.occurred_at, m.id)
       ) AS number,
       r.id AS restaurant_id, r.name AS restaurant_name,
       r.archived_at IS NOT NULL AS restaurant_archived
FROM (
    SELECT * FROM meals m
    WHERE m.user_id = %(user)s AND true AND m.day >= %(from_day)s AND m.day <= %(to_day)s
    ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
    LIMIT %(limit)s
) m
LEFT JOIN restaurants r ON r.id = m.restaurant_id
ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC

```

```
Nested Loop Left Join  (cost=16.60..54.63 rows=3 width=118) (actual time=0.039..0.049 rows=3.00 loops=1)
  Buffers: shared hit=14
  ->  Limit  (cost=16.32..16.32 rows=3 width=129) (actual time=0.022..0.023 rows=3.00 loops=1)
        Buffers: shared hit=4
        ->  Sort  (cost=16.32..16.32 rows=3 width=129) (actual time=0.021..0.022 rows=3.00 loops=1)
              Sort Key: m.day DESC, m.occurred_at DESC, m.id DESC
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=4
              ->  Bitmap Heap Scan on meals m  (cost=4.46..16.29 rows=3 width=129) (actual time=0.015..0.015 rows=3.00 loops=1)
                    Recheck Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (day >= '2025-12-29'::date) AND (day <= '2025-12-29'::date))
                    Heap Blocks: exact=1
                    Buffers: shared hit=4
                    ->  Bitmap Index Scan on meals_user_day  (cost=0.00..4.46 rows=3 width=0) (actual time=0.007..0.007 rows=3.00 loops=1)
                          Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (day >= '2025-12-29'::date) AND (day <= '2025-12-29'::date))
                          Index Searches: 1
                          Buffers: shared hit=3
  ->  Index Scan using restaurants_id_user_id_key on restaurants r  (cost=0.28..8.30 rows=1 width=36) (actual time=0.000..0.001 rows=0.00 loops=3)
        Index Cond: (id = m.restaurant_id)
        Index Searches: 0
  SubPlan 1
    ->  Aggregate  (cost=4.45..4.46 rows=1 width=8) (actual time=0.006..0.006 rows=1.00 loops=3)
          Buffers: shared hit=10
          ->  Index Only Scan using meals_user_day on meals n  (cost=0.42..4.45 rows=1 width=0) (actual time=0.004..0.004 rows=2.00 loops=3)
                Index Cond: ((user_id = m.user_id) AND (day = m.day) AND (ROW(occurred_at, id) <= ROW(m.occurred_at, m.id)))
                Heap Fetches: 0
                Index Searches: 3
                Buffers: shared hit=10
Planning:
  Buffers: shared hit=6
Planning Time: 0.312 ms
Execution Time: 0.084 ms
```

```sql
SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
       f.archived_at IS NOT NULL AS archived
FROM food_entries e
JOIN foods f ON f.id = e.food_id
WHERE e.user_id = %(user)s AND e.meal_id = ANY(%(meal_ids)s)
ORDER BY e.id

```

```
Sort  (cost=25.82..25.82 rows=1 width=70) (actual time=0.050..0.051 rows=12.00 loops=1)
  Sort Key: e.id
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=43
  ->  Nested Loop  (cost=0.71..25.81 rows=1 width=70) (actual time=0.016..0.044 rows=12.00 loops=1)
        Buffers: shared hit=43
        ->  Index Scan using food_entries_meal on food_entries e  (cost=0.42..17.50 rows=1 width=56) (actual time=0.011..0.017 rows=12.00 loops=1)
              Index Cond: (meal_id = ANY ('{019b69ac-f020-736e-bd7b-4efaa5a95ab6,019b684e-4a80-703c-aa33-170d872c9980,019b6732-7a40-7b80-a2e1-21c4ab6042de}'::uuid[]))
              Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Index Searches: 2
              Buffers: shared hit=7
        ->  Index Scan using foods_id_user_id_key on foods f  (cost=0.29..8.30 rows=1 width=37) (actual time=0.002..0.002 rows=1.00 loops=12)
              Index Cond: (id = e.food_id)
              Index Searches: 12
              Buffers: shared hit=36
Planning:
  Buffers: shared hit=6
Planning Time: 0.219 ms
Execution Time: 0.068 ms
```

## Meals newest first

```sql
SELECT m.id, m.kind, m.label, m.occurred_at, m.occurred_tz, m.day,
       (
           SELECT count(*) FROM meals n
           WHERE n.user_id = m.user_id AND n.day = m.day
             AND (n.occurred_at, n.id) <= (m.occurred_at, m.id)
       ) AS number,
       r.id AS restaurant_id, r.name AS restaurant_name,
       r.archived_at IS NOT NULL AS restaurant_archived
FROM (
    SELECT * FROM meals m
    WHERE m.user_id = %(user)s AND true
    ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
    LIMIT %(limit)s
) m
LEFT JOIN restaurants r ON r.id = m.restaurant_id
ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC

```

```
Sort  (cost=463.54..463.67 rows=51 width=118) (actual time=0.606..0.610 rows=51.00 loops=1)
  Sort Key: m.day DESC, m.occurred_at DESC, m.id DESC
  Sort Method: quicksort  Memory: 29kB
  Buffers: shared hit=210
  ->  Hash Right Join  (cost=158.47..462.10 rows=51 width=118) (actual time=0.117..0.579 rows=51.00 loops=1)
        Hash Cond: (r.id = m.restaurant_id)
        Buffers: shared hit=210
        ->  Seq Scan on restaurants r  (cost=0.00..65.00 rows=3000 width=36) (actual time=0.013..0.155 rows=3000.00 loops=1)
              Buffers: shared hit=35
        ->  Hash  (cost=157.83..157.83 rows=51 width=113) (actual time=0.074..0.075 rows=51.00 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 13kB
              Buffers: shared hit=21
              ->  Subquery Scan on m  (cost=0.42..157.83 rows=51 width=113) (actual time=0.020..0.065 rows=51.00 loops=1)
                    Buffers: shared hit=21
                    ->  Limit  (cost=0.42..157.32 rows=51 width=129) (actual time=0.020..0.060 rows=51.00 loops=1)
                          Buffers: shared hit=21
                          ->  Index Scan Backward using meals_user_day on meals m_1  (cost=0.42..10343.24 rows=3362 width=129) (actual time=0.018..0.056 rows=51.00 loops=1)
                                Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                                Index Searches: 1
                                Buffers: shared hit=21
        SubPlan 1
          ->  Aggregate  (cost=4.45..4.46 rows=1 width=8) (actual time=0.003..0.003 rows=1.00 loops=51)
                Buffers: shared hit=154
                ->  Index Only Scan using meals_user_day on meals n  (cost=0.42..4.45 rows=1 width=0) (actual time=0.002..0.002 rows=2.00 loops=51)
                      Index Cond: ((user_id = m.user_id) AND (day = m.day) AND (ROW(occurred_at, id) <= ROW(m.occurred_at, m.id)))
                      Heap Fetches: 0
                      Index Searches: 51
                      Buffers: shared hit=154
Planning:
  Buffers: shared hit=6
Planning Time: 0.385 ms
Execution Time: 0.669 ms
```

```sql
SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
       f.archived_at IS NOT NULL AS archived
FROM food_entries e
JOIN foods f ON f.id = e.food_id
WHERE e.user_id = %(user)s AND e.meal_id = ANY(%(meal_ids)s)
ORDER BY e.id

```

```
Sort  (cost=216.21..216.22 rows=2 width=70) (actual time=1.286..1.292 rows=145.00 loops=1)
  Sort Key: e.id
  Sort Method: quicksort  Memory: 37kB
  Buffers: shared hit=550
  ->  Nested Loop  (cost=0.71..216.20 rows=2 width=70) (actual time=0.378..1.212 rows=145.00 loops=1)
        Buffers: shared hit=550
        ->  Index Scan using food_entries_meal on food_entries e  (cost=0.42..199.59 rows=2 width=56) (actual time=0.349..0.655 rows=145.00 loops=1)
              Index Cond: (meal_id = ANY ('{019b6ec4-a620-7c6b-b6bf-d7c6a97c6e48,019b6d33-a5e0-76c9-90d4-c1c9b980d92b,019b6c3b-8a40-73bd-91e7-a125db712543,019b69ac-f020-736e-bd7b-4efaa5a95ab6,019b684e-4a80-703c-aa33-170d872c9980,019b6732-7a40-7b80-a2e1-21c4ab6042de,019b6449-3d00-788f-8f47-cb2dad057405,019b62e8-c2a0-75c3-a41b-c3e6f930ed69,019b6215-4600-714e-90d6-18a3d040b901,019b5de4-4680-7fb7-af2e-927b21186b7a,019b5cf2-9380-7103-8e1e-793a0c821ab6,019b5a02-eda0-7db0-9827-ef980938af2b,019b57ce-f6a0-7443-b941-25c6acc6a6bc,019b5389-d2e0-7863-8d01-0d11d2ac7cac,019b528e-0dc0-7797-a093-7b8569918be4,019b4d93-a3c0-75c5-90b7-4dfa6b7a2091,019b4abc-b600-7ffa-b92b-ba86bb32acad,019b495e-1060-7780-8089-f4555de9ed71,019b4856-6460-7b8b-9628-fa5bc8cb6e2a,019b4330-0860-76b5-8d81-58e59b2d7890,019b407e-a400-74b1-8f64-153739a3a469,019b3f1c-54e0-73b7-abb2-39dfe1456a16,019b3df9-31a0-74e6-9b8f-cc4b84c0b89b,019b3b45-0e20-7621-a9d3-ba5655e65bd8,019b39ed-bb80-7247-b31d-1e5969769123,019b38ee-4ce0-766b-bf5f-d96227a36a66,019b35f2-c020-77bf-99e2-4aa98fba4ae9,019b3488-33a0-7c1e-9aa4-14f0cb45e19a,019b33ce-5980-7b4c-bb30-2dff3fab2a2f,019b30ec-6f40-7481-8f71-d3cd14a54551,019b2ea7-1320-7468-81ba-b09a94faf58b,019b2bd4-b940-7b89-8048-a37918b70edc,019b2a74-3ee0-720c-9a39-0f839faebad1,019b293d-e1c0-71b5-92f8-65908b52dc1b,019b26b2-06c0-7d1a-9eb6-97488d23024c,019b2527-6f20-779c-886b-a6198ab26777,019b2430-3de0-764e-b9b0-fa2ff2c3be72,019b215d-e400-774a-8c9e-2f0cf52edb06,019b1feb-1a20-7462-8c18-d78f1eb90689,019b1efd-fb00-755d-b996-0d6dd1797e29,019b1c2e-6040-7dad-827f-f3f62fd7d62c,019b1af8-0320-7629-9b25-49966e3bedb0,019b19e2-9b80-79bd-898a-48d370ce04a4}'::uuid[]))
              Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Index Searches: 32
              Buffers: shared hit=115
        ->  Index Scan using foods_id_user_id_key on foods f  (cost=0.29..8.30 rows=1 width=37) (actual time=0.003..0.003 rows=1.00 loops=145)
              Index Cond: (id = e.food_id)
              Index Searches: 145
              Buffers: shared hit=435
Planning:
  Buffers: shared hit=6
Planning Time: 4.960 ms
Execution Time: 1.419 ms
```

## Meals next page

```sql
SELECT m.id, m.kind, m.label, m.occurred_at, m.occurred_tz, m.day,
       (
           SELECT count(*) FROM meals n
           WHERE n.user_id = m.user_id AND n.day = m.day
             AND (n.occurred_at, n.id) <= (m.occurred_at, m.id)
       ) AS number,
       r.id AS restaurant_id, r.name AS restaurant_name,
       r.archived_at IS NOT NULL AS restaurant_archived
FROM (
    SELECT * FROM meals m
    WHERE m.user_id = %(user)s AND true AND (m.day, m.occurred_at, m.id) < (%(cursor_day)s, %(cursor_at)s, %(cursor_id)s)
    ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
    LIMIT %(limit)s
) m
LEFT JOIN restaurants r ON r.id = m.restaurant_id
ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC

```

```
Sort  (cost=463.69..463.82 rows=51 width=118) (actual time=0.613..0.617 rows=51.00 loops=1)
  Sort Key: m.day DESC, m.occurred_at DESC, m.id DESC
  Sort Method: quicksort  Memory: 29kB
  Buffers: shared hit=211
  ->  Hash Right Join  (cost=158.61..462.24 rows=51 width=118) (actual time=0.085..0.594 rows=51.00 loops=1)
        Hash Cond: (r.id = m.restaurant_id)
        Buffers: shared hit=211
        ->  Seq Scan on restaurants r  (cost=0.00..65.00 rows=3000 width=36) (actual time=0.006..0.140 rows=3000.00 loops=1)
              Buffers: shared hit=35
        ->  Hash  (cost=157.97..157.97 rows=51 width=113) (actual time=0.063..0.064 rows=51.00 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 13kB
              Buffers: shared hit=22
              ->  Subquery Scan on m  (cost=0.42..157.97 rows=51 width=113) (actual time=0.015..0.054 rows=51.00 loops=1)
                    Buffers: shared hit=22
                    ->  Limit  (cost=0.42..157.46 rows=51 width=129) (actual time=0.015..0.050 rows=51.00 loops=1)
                          Buffers: shared hit=22
                          ->  Index Scan Backward using meals_user_day on meals m_1  (cost=0.42..10343.59 rows=3359 width=129) (actual time=0.014..0.046 rows=51.00 loops=1)
                                Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (ROW(day, occurred_at, id) < ROW('2025-12-30'::date, '2025-12-30 03:01:00+00'::timestamp with time zone, '019b6d33-a5e0-76c9-90d4-c1c9b980d92b'::uuid)))
                                Index Searches: 1
                                Buffers: shared hit=22
        SubPlan 1
          ->  Aggregate  (cost=4.45..4.46 rows=1 width=8) (actual time=0.002..0.002 rows=1.00 loops=51)
                Buffers: shared hit=154
                ->  Index Only Scan using meals_user_day on meals n  (cost=0.42..4.45 rows=1 width=0) (actual time=0.001..0.002 rows=2.00 loops=51)
                      Index Cond: ((user_id = m.user_id) AND (day = m.day) AND (ROW(occurred_at, id) <= ROW(m.occurred_at, m.id)))
                      Heap Fetches: 0
                      Index Searches: 51
                      Buffers: shared hit=154
Planning:
  Buffers: shared hit=6
Planning Time: 0.265 ms
Execution Time: 0.655 ms
```

```sql
SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
       f.archived_at IS NOT NULL AS archived
FROM food_entries e
JOIN foods f ON f.id = e.food_id
WHERE e.user_id = %(user)s AND e.meal_id = ANY(%(meal_ids)s)
ORDER BY e.id

```

```
Sort  (cost=216.21..216.22 rows=2 width=70) (actual time=0.525..0.531 rows=145.00 loops=1)
  Sort Key: e.id
  Sort Method: quicksort  Memory: 37kB
  Buffers: shared hit=551
  ->  Nested Loop  (cost=0.71..216.20 rows=2 width=70) (actual time=0.028..0.466 rows=145.00 loops=1)
        Buffers: shared hit=551
        ->  Index Scan using food_entries_meal on food_entries e  (cost=0.42..199.59 rows=2 width=56) (actual time=0.022..0.165 rows=145.00 loops=1)
              Index Cond: (meal_id = ANY ('{019b6c3b-8a40-73bd-91e7-a125db712543,019b69ac-f020-736e-bd7b-4efaa5a95ab6,019b684e-4a80-703c-aa33-170d872c9980,019b6732-7a40-7b80-a2e1-21c4ab6042de,019b6449-3d00-788f-8f47-cb2dad057405,019b62e8-c2a0-75c3-a41b-c3e6f930ed69,019b6215-4600-714e-90d6-18a3d040b901,019b5de4-4680-7fb7-af2e-927b21186b7a,019b5cf2-9380-7103-8e1e-793a0c821ab6,019b5a02-eda0-7db0-9827-ef980938af2b,019b57ce-f6a0-7443-b941-25c6acc6a6bc,019b5389-d2e0-7863-8d01-0d11d2ac7cac,019b528e-0dc0-7797-a093-7b8569918be4,019b4d93-a3c0-75c5-90b7-4dfa6b7a2091,019b4abc-b600-7ffa-b92b-ba86bb32acad,019b495e-1060-7780-8089-f4555de9ed71,019b4856-6460-7b8b-9628-fa5bc8cb6e2a,019b4330-0860-76b5-8d81-58e59b2d7890,019b407e-a400-74b1-8f64-153739a3a469,019b3f1c-54e0-73b7-abb2-39dfe1456a16,019b3df9-31a0-74e6-9b8f-cc4b84c0b89b,019b3b45-0e20-7621-a9d3-ba5655e65bd8,019b39ed-bb80-7247-b31d-1e5969769123,019b38ee-4ce0-766b-bf5f-d96227a36a66,019b35f2-c020-77bf-99e2-4aa98fba4ae9,019b3488-33a0-7c1e-9aa4-14f0cb45e19a,019b33ce-5980-7b4c-bb30-2dff3fab2a2f,019b30ec-6f40-7481-8f71-d3cd14a54551,019b2ea7-1320-7468-81ba-b09a94faf58b,019b2bd4-b940-7b89-8048-a37918b70edc,019b2a74-3ee0-720c-9a39-0f839faebad1,019b293d-e1c0-71b5-92f8-65908b52dc1b,019b26b2-06c0-7d1a-9eb6-97488d23024c,019b2527-6f20-779c-886b-a6198ab26777,019b2430-3de0-764e-b9b0-fa2ff2c3be72,019b215d-e400-774a-8c9e-2f0cf52edb06,019b1feb-1a20-7462-8c18-d78f1eb90689,019b1efd-fb00-755d-b996-0d6dd1797e29,019b1c2e-6040-7dad-827f-f3f62fd7d62c,019b1af8-0320-7629-9b25-49966e3bedb0,019b19e2-9b80-79bd-898a-48d370ce04a4,019b1711-2c00-71b7-a119-d1b9ee8c2346,019b15c0-4200-7345-9747-d54634abc3a6}'::uuid[]))
              Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Index Searches: 32
              Buffers: shared hit=116
        ->  Index Scan using foods_id_user_id_key on foods f  (cost=0.29..8.30 rows=1 width=37) (actual time=0.002..0.002 rows=1.00 loops=145)
              Index Cond: (id = e.food_id)
              Index Searches: 145
              Buffers: shared hit=435
Planning:
  Buffers: shared hit=6
Planning Time: 0.175 ms
Execution Time: 0.558 ms
```

## Meals with a common Food

```sql
SELECT m.id, m.kind, m.label, m.occurred_at, m.occurred_tz, m.day,
       (
           SELECT count(*) FROM meals n
           WHERE n.user_id = m.user_id AND n.day = m.day
             AND (n.occurred_at, n.id) <= (m.occurred_at, m.id)
       ) AS number,
       r.id AS restaurant_id, r.name AS restaurant_name,
       r.archived_at IS NOT NULL AS restaurant_archived
FROM (
    SELECT * FROM meals m
    WHERE m.user_id = %(user)s AND true AND 
    m.id IN (
        SELECT e.meal_id FROM food_entries e
        WHERE e.user_id = %(user)s AND e.food_id = %(food_id)s
    )

    ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
    LIMIT %(limit)s
) m
LEFT JOIN restaurants r ON r.id = m.restaurant_id
ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC

```

```
Nested Loop Left Join  (cost=152.87..165.37 rows=1 width=118) (actual time=6.770..6.913 rows=51.00 loops=1)
  Buffers: shared hit=5647
  ->  Limit  (cost=152.59..152.60 rows=1 width=129) (actual time=6.721..6.732 rows=51.00 loops=1)
        Buffers: shared hit=5493
        ->  Sort  (cost=152.59..152.60 rows=1 width=129) (actual time=6.719..6.726 rows=51.00 loops=1)
              Sort Key: m.day DESC, m.occurred_at DESC, m.id DESC
              Sort Method: top-N heapsort  Memory: 36kB
              Buffers: shared hit=5493
              ->  Nested Loop  (cost=9.23..152.58 rows=1 width=129) (actual time=0.480..6.350 rows=1369.00 loops=1)
                    Buffers: shared hit=5493
                    ->  HashAggregate  (cost=8.81..8.98 rows=17 width=16) (actual time=0.466..0.677 rows=1369.00 loops=1)
                          Group Key: e.meal_id
                          Batches: 1  Memory Usage: 145kB
                          Buffers: shared hit=17
                          ->  Index Only Scan using food_entries_user_food on food_entries e  (cost=0.42..8.77 rows=17 width=16) (actual time=0.013..0.168 rows=1728.00 loops=1)
                                Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (food_id = '01856aa0-c800-7905-a3f4-d8399428f612'::uuid))
                                Heap Fetches: 0
                                Index Searches: 1
                                Buffers: shared hit=17
                    ->  Index Scan using meals_id_kind_key on meals m  (cost=0.42..8.44 rows=1 width=113) (actual time=0.004..0.004 rows=1.00 loops=1369)
                          Index Cond: (id = e.meal_id)
                          Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 1369
                          Buffers: shared hit=5476
  ->  Index Scan using restaurants_id_user_id_key on restaurants r  (cost=0.28..8.30 rows=1 width=36) (actual time=0.000..0.000 rows=0.00 loops=51)
        Index Cond: (id = m.restaurant_id)
        Index Searches: 0
  SubPlan 1
    ->  Aggregate  (cost=4.45..4.46 rows=1 width=8) (actual time=0.002..0.002 rows=1.00 loops=51)
          Buffers: shared hit=154
          ->  Index Only Scan using meals_user_day on meals n  (cost=0.42..4.45 rows=1 width=0) (actual time=0.002..0.002 rows=2.16 loops=51)
                Index Cond: ((user_id = m.user_id) AND (day = m.day) AND (ROW(occurred_at, id) <= ROW(m.occurred_at, m.id)))
                Heap Fetches: 0
                Index Searches: 51
                Buffers: shared hit=154
Planning:
  Buffers: shared hit=38
Planning Time: 0.539 ms
Execution Time: 6.980 ms
```

```sql
SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
       f.archived_at IS NOT NULL AS archived
FROM food_entries e
JOIN foods f ON f.id = e.food_id
WHERE e.user_id = %(user)s AND e.meal_id = ANY(%(meal_ids)s)
ORDER BY e.id

```

```
Sort  (cost=253.23..253.23 rows=2 width=70) (actual time=0.610..0.617 rows=189.00 loops=1)
  Sort Key: e.id
  Sort Method: quicksort  Memory: 41kB
  Buffers: shared hit=735
  ->  Nested Loop  (cost=0.71..253.22 rows=2 width=70) (actual time=0.030..0.565 rows=189.00 loops=1)
        Buffers: shared hit=735
        ->  Index Scan using food_entries_meal on food_entries e  (cost=0.42..236.61 rows=2 width=56) (actual time=0.023..0.223 rows=189.00 loops=1)
              Index Cond: (meal_id = ANY ('{019b6ec4-a620-7c6b-b6bf-d7c6a97c6e48,019b6c3b-8a40-73bd-91e7-a125db712543,019b69ac-f020-736e-bd7b-4efaa5a95ab6,019b684e-4a80-703c-aa33-170d872c9980,019b6215-4600-714e-90d6-18a3d040b901,019b5de4-4680-7fb7-af2e-927b21186b7a,019b57ce-f6a0-7443-b941-25c6acc6a6bc,019b495e-1060-7780-8089-f4555de9ed71,019b35f2-c020-77bf-99e2-4aa98fba4ae9,019b30ec-6f40-7481-8f71-d3cd14a54551,019b2ea7-1320-7468-81ba-b09a94faf58b,019b2a74-3ee0-720c-9a39-0f839faebad1,019b2527-6f20-779c-886b-a6198ab26777,019b2430-3de0-764e-b9b0-fa2ff2c3be72,019b215d-e400-774a-8c9e-2f0cf52edb06,019b1af8-0320-7629-9b25-49966e3bedb0,019b1711-2c00-71b7-a119-d1b9ee8c2346,019b0b66-b8c0-7787-af0b-9e1eedf11b4c,019b0635-6040-7c14-b0aa-52b8d92f8a3d,019b027f-0f00-7fe0-ac91-f07a5f8d166b,019b012f-f9c0-725e-8e7f-3afb84183a95,019afd89-38e0-7a1e-9c3a-d459d2ef390a,019af84b-0f20-7496-a0a2-d92fbec9ffdf,019af6b2-bbe0-71b3-ac75-88de75f41d49,019af5ea-3bc0-79d0-8bdb-4b4fa6c7d728,019af32e-c540-7578-b34a-ab53898f89f9,019af1d0-1fa0-7647-8171-f179ca4f5f46,019aedcb-1220-751c-8a31-fd9c51ee0535,019ae247-12a0-704c-b3a3-2dd061762aba,019ade65-b9c0-7896-96f7-d9a487634600,019ad7e9-dfe0-7452-bd2e-ad4e80817ddd,019ad1fd-c2e0-7bd2-8325-a10b262fc2df,019acef0-d100-7e8f-a1f4-7d90edb373a6,019ac86a-e500-717b-9e0f-83ac34a75bf1,019ac369-2800-7088-9264-f7969301c828,019ac23f-9c20-7604-bd9e-75f43212ec79,019abf9b-f360-755c-9ce1-9a237a407e07,019abe53-46c0-7876-8e61-2a627a9189a5,019aba63-47e0-7122-ba03-79722116a966,019ab8e8-40a0-7b5d-af1c-5f36c96b730b,019ab555-a400-7a00-9f98-01af3deddb4a,019ab00d-6820-7249-a237-397692afc69d,019aaded-9560-7526-9967-4ef9a2e15007,019aaafc-1ac0-795e-b53f-253a96a02ca0,019aa991-8e40-76e1-b6cb-2050d48d224e,019aa39b-5f20-757d-8c34-d5c1c47a3007,019a9f32-86c0-7b01-8455-72a264cde428,019a9e4c-baa0-797c-a6c7-29d861880a66,019a9bae-9020-7fd2-8b41-01632d8542f8,019a9939-9880-797b-89c5-94007633fdc2,019a964e-8680-7170-b6b4-ba6aaec42a31}'::uuid[]))
              Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Index Searches: 44
              Buffers: shared hit=168
        ->  Index Scan using foods_id_user_id_key on foods f  (cost=0.29..8.30 rows=1 width=37) (actual time=0.001..0.001 rows=1.00 loops=189)
              Index Cond: (id = e.food_id)
              Index Searches: 189
              Buffers: shared hit=567
Planning:
  Buffers: shared hit=6
Planning Time: 0.286 ms
Execution Time: 0.655 ms
```

## Meals with a rare Food

```sql
SELECT m.id, m.kind, m.label, m.occurred_at, m.occurred_tz, m.day,
       (
           SELECT count(*) FROM meals n
           WHERE n.user_id = m.user_id AND n.day = m.day
             AND (n.occurred_at, n.id) <= (m.occurred_at, m.id)
       ) AS number,
       r.id AS restaurant_id, r.name AS restaurant_name,
       r.archived_at IS NOT NULL AS restaurant_archived
FROM (
    SELECT * FROM meals m
    WHERE m.user_id = %(user)s AND true AND 
    m.id IN (
        SELECT e.meal_id FROM food_entries e
        WHERE e.user_id = %(user)s AND e.food_id = %(food_id)s
    )

    ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
    LIMIT %(limit)s
) m
LEFT JOIN restaurants r ON r.id = m.restaurant_id
ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC

```

```
Nested Loop Left Join  (cost=17.19..29.69 rows=1 width=118) (actual time=0.053..0.070 rows=5.00 loops=1)
  Buffers: shared hit=40
  ->  Limit  (cost=16.91..16.92 rows=1 width=129) (actual time=0.042..0.043 rows=5.00 loops=1)
        Buffers: shared hit=24
        ->  Sort  (cost=16.91..16.92 rows=1 width=129) (actual time=0.041..0.042 rows=5.00 loops=1)
              Sort Key: m.day DESC, m.occurred_at DESC, m.id DESC
              Sort Method: quicksort  Memory: 25kB
              Buffers: shared hit=24
              ->  Nested Loop  (cost=8.87..16.90 rows=1 width=129) (actual time=0.019..0.035 rows=5.00 loops=1)
                    Buffers: shared hit=24
                    ->  HashAggregate  (cost=8.45..8.46 rows=1 width=16) (actual time=0.012..0.013 rows=5.00 loops=1)
                          Group Key: e.meal_id
                          Batches: 1  Memory Usage: 32kB
                          Buffers: shared hit=4
                          ->  Index Only Scan using food_entries_user_food on food_entries e  (cost=0.42..8.45 rows=1 width=16) (actual time=0.007..0.008 rows=5.00 loops=1)
                                Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (food_id = '01856aa0-c800-7563-adb4-9cfcfa89b57c'::uuid))
                                Heap Fetches: 0
                                Index Searches: 1
                                Buffers: shared hit=4
                    ->  Index Scan using meals_id_kind_key on meals m  (cost=0.42..8.44 rows=1 width=113) (actual time=0.004..0.004 rows=1.00 loops=5)
                          Index Cond: (id = e.meal_id)
                          Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 5
                          Buffers: shared hit=20
  ->  Index Scan using restaurants_id_user_id_key on restaurants r  (cost=0.28..8.30 rows=1 width=36) (actual time=0.000..0.000 rows=0.00 loops=5)
        Index Cond: (id = m.restaurant_id)
        Index Searches: 0
  SubPlan 1
    ->  Aggregate  (cost=4.45..4.46 rows=1 width=8) (actual time=0.004..0.004 rows=1.00 loops=5)
          Buffers: shared hit=16
          ->  Index Only Scan using meals_user_day on meals n  (cost=0.42..4.45 rows=1 width=0) (actual time=0.003..0.003 rows=1.20 loops=5)
                Index Cond: ((user_id = m.user_id) AND (day = m.day) AND (ROW(occurred_at, id) <= ROW(m.occurred_at, m.id)))
                Heap Fetches: 0
                Index Searches: 5
                Buffers: shared hit=16
Planning:
  Buffers: shared hit=38
Planning Time: 0.411 ms
Execution Time: 0.106 ms
```

```sql
SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
       f.archived_at IS NOT NULL AS archived
FROM food_entries e
JOIN foods f ON f.id = e.food_id
WHERE e.user_id = %(user)s AND e.meal_id = ANY(%(meal_ids)s)
ORDER BY e.id

```

```
Sort  (cost=34.83..34.83 rows=1 width=70) (actual time=0.067..0.068 rows=16.00 loops=1)
  Sort Key: e.id
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=68
  ->  Nested Loop  (cost=0.71..34.82 rows=1 width=70) (actual time=0.011..0.061 rows=16.00 loops=1)
        Buffers: shared hit=68
        ->  Index Scan using food_entries_meal on food_entries e  (cost=0.42..26.51 rows=1 width=56) (actual time=0.007..0.019 rows=16.00 loops=1)
              Index Cond: (meal_id = ANY ('{019a951b-d2e0-78ff-b717-5b668730ce18,01958c93-5260-79a6-b2d8-c563e224e2eb,0194050c-4dc0-7031-9bb9-e27c197796a7,018d5245-c280-7746-b4a2-3783b66b1dbb,018afcda-0060-77cf-a558-8babbcbd0dcf}'::uuid[]))
              Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Index Searches: 5
              Buffers: shared hit=20
        ->  Index Scan using foods_id_user_id_key on foods f  (cost=0.29..8.30 rows=1 width=37) (actual time=0.002..0.002 rows=1.00 loops=16)
              Index Cond: (id = e.food_id)
              Index Searches: 16
              Buffers: shared hit=48
Planning:
  Buffers: shared hit=6
Planning Time: 0.146 ms
Execution Time: 0.083 ms
```

## One Meal

```sql
SELECT m.id, m.kind, m.label, m.occurred_at, m.occurred_tz, m.day,
       (
           SELECT count(*) FROM meals n
           WHERE n.user_id = m.user_id AND n.day = m.day
             AND (n.occurred_at, n.id) <= (m.occurred_at, m.id)
       ) AS number,
       r.id AS restaurant_id, r.name AS restaurant_name,
       r.archived_at IS NOT NULL AS restaurant_archived
FROM (
    SELECT * FROM meals m
    WHERE m.user_id = %(user)s AND m.id = %(id)s
    ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC
    LIMIT %(limit)s
) m
LEFT JOIN restaurants r ON r.id = m.restaurant_id
ORDER BY m.day DESC, m.occurred_at DESC, m.id DESC

```

```
Incremental Sort  (cost=21.24..21.28 rows=2 width=118) (actual time=0.045..0.046 rows=1.00 loops=1)
  Sort Key: m.day DESC, m.occurred_at DESC, m.id DESC
  Presorted Key: m.day, m.occurred_at
  Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 25kB  Peak Memory: 25kB
  Buffers: shared hit=8
  ->  Nested Loop Left Join  (cost=8.73..21.23 rows=1 width=118) (actual time=0.039..0.040 rows=1.00 loops=1)
        Buffers: shared hit=8
        ->  Limit  (cost=8.45..8.46 rows=1 width=129) (actual time=0.018..0.019 rows=1.00 loops=1)
              Buffers: shared hit=4
              ->  Sort  (cost=8.45..8.46 rows=1 width=129) (actual time=0.017..0.018 rows=1.00 loops=1)
                    Sort Key: m.day DESC, m.occurred_at DESC
                    Sort Method: quicksort  Memory: 25kB
                    Buffers: shared hit=4
                    ->  Index Scan using meals_id_kind_key on meals m  (cost=0.42..8.44 rows=1 width=129) (actual time=0.013..0.014 rows=1.00 loops=1)
                          Index Cond: (id = '019b6ec4-a620-7c6b-b6bf-d7c6a97c6e48'::uuid)
                          Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=4
        ->  Index Scan using restaurants_id_user_id_key on restaurants r  (cost=0.28..8.30 rows=1 width=36) (actual time=0.001..0.001 rows=0.00 loops=1)
              Index Cond: (id = m.restaurant_id)
              Index Searches: 0
        SubPlan 1
          ->  Aggregate  (cost=4.45..4.46 rows=1 width=8) (actual time=0.015..0.015 rows=1.00 loops=1)
                Buffers: shared hit=4
                ->  Index Only Scan using meals_user_day on meals n  (cost=0.42..4.45 rows=1 width=0) (actual time=0.011..0.011 rows=3.00 loops=1)
                      Index Cond: ((user_id = m.user_id) AND (day = m.day) AND (ROW(occurred_at, id) <= ROW(m.occurred_at, m.id)))
                      Heap Fetches: 0
                      Index Searches: 1
                      Buffers: shared hit=4
Planning:
  Buffers: shared hit=6
Planning Time: 0.363 ms
Execution Time: 0.085 ms
```

```sql
SELECT e.meal_id, e.quantity, e.unit, f.id, f.name,
       f.archived_at IS NOT NULL AS archived
FROM food_entries e
JOIN foods f ON f.id = e.food_id
WHERE e.user_id = %(user)s AND e.meal_id = ANY(%(meal_ids)s)
ORDER BY e.id

```

```
Sort  (cost=16.82..16.83 rows=1 width=70) (actual time=0.025..0.025 rows=3.00 loops=1)
  Sort Key: e.id
  Sort Method: quicksort  Memory: 25kB
  Buffers: shared hit=13
  ->  Nested Loop  (cost=0.71..16.81 rows=1 width=70) (actual time=0.014..0.020 rows=3.00 loops=1)
        Buffers: shared hit=13
        ->  Index Scan using food_entries_meal on food_entries e  (cost=0.42..8.51 rows=1 width=56) (actual time=0.009..0.010 rows=3.00 loops=1)
              Index Cond: (meal_id = ANY ('{019b6ec4-a620-7c6b-b6bf-d7c6a97c6e48}'::uuid[]))
              Filter: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Index Searches: 1
              Buffers: shared hit=4
        ->  Index Scan using foods_id_user_id_key on foods f  (cost=0.29..8.30 rows=1 width=37) (actual time=0.002..0.002 rows=1.00 loops=3)
              Index Cond: (id = e.food_id)
              Index Searches: 3
              Buffers: shared hit=9
Planning:
  Buffers: shared hit=6
Planning Time: 0.156 ms
Execution Time: 0.041 ms
```

## Sets on a Day

```sql
SELECT e.id, e.reps, e.weight_lb, e.occurred_at, e.occurred_tz, e.day,
       (
           SELECT count(*) FROM exercise_entries n
           WHERE n.user_id = e.user_id AND n.exercise_id = e.exercise_id
             AND n.day = e.day
             AND (n.occurred_at, n.id) <= (e.occurred_at, e.id)
       ) AS number,
       x.id AS exercise_id, x.name AS exercise_name,
       x.archived_at IS NOT NULL AS exercise_archived
FROM (
    SELECT * FROM exercise_entries e
    WHERE e.user_id = %(user)s AND true AND e.day >= %(from_day)s AND e.day <= %(to_day)s
    ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC
    LIMIT %(limit)s
) e
JOIN exercises x ON x.id = e.exercise_id
ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC

```

```
Nested Loop  (cost=0.84..399.05 rows=20 width=92) (actual time=0.035..0.180 rows=31.00 loops=1)
  Buffers: shared hit=223
  ->  Limit  (cost=0.56..85.00 rows=20 width=100) (actual time=0.014..0.025 rows=31.00 loops=1)
        Buffers: shared hit=5
        ->  Index Scan Backward using exercise_entries_user_day on exercise_entries e  (cost=0.56..85.00 rows=20 width=100) (actual time=0.014..0.022 rows=31.00 loops=1)
              Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (day >= '2025-12-29'::date) AND (day <= '2025-12-29'::date))
              Index Searches: 1
              Buffers: shared hit=5
  ->  Index Scan using exercises_pkey on exercises x  (cost=0.28..7.10 rows=1 width=39) (actual time=0.001..0.001 rows=1.00 loops=31)
        Index Cond: (id = e.exercise_id)
        Index Searches: 31
        Buffers: shared hit=93
  SubPlan 1
    ->  Aggregate  (cost=8.58..8.59 rows=1 width=8) (actual time=0.003..0.003 rows=1.00 loops=31)
          Buffers: shared hit=125
          ->  Index Only Scan using exercise_entries_user_exercise_day on exercise_entries n  (cost=0.56..8.58 rows=1 width=0) (actual time=0.002..0.002 rows=3.19 loops=31)
                Index Cond: ((user_id = e.user_id) AND (exercise_id = e.exercise_id) AND (day = e.day) AND (ROW(occurred_at, id) <= ROW(e.occurred_at, e.id)))
                Heap Fetches: 0
                Index Searches: 31
                Buffers: shared hit=125
Planning:
  Buffers: shared hit=6
Planning Time: 0.246 ms
Execution Time: 0.211 ms
```

## Sets newest first

```sql
SELECT e.id, e.reps, e.weight_lb, e.occurred_at, e.occurred_tz, e.day,
       (
           SELECT count(*) FROM exercise_entries n
           WHERE n.user_id = e.user_id AND n.exercise_id = e.exercise_id
             AND n.day = e.day
             AND (n.occurred_at, n.id) <= (e.occurred_at, e.id)
       ) AS number,
       x.id AS exercise_id, x.name AS exercise_name,
       x.archived_at IS NOT NULL AS exercise_archived
FROM (
    SELECT * FROM exercise_entries e
    WHERE e.user_id = %(user)s AND true
    ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC
    LIMIT %(limit)s
) e
JOIN exercises x ON x.id = e.exercise_id
ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC

```

```
Sort  (cost=756.48..756.61 rows=51 width=92) (actual time=1.149..1.154 rows=51.00 loops=1)
  Sort Key: e.day DESC, e.occurred_at DESC, e.id DESC
  Sort Method: quicksort  Memory: 30kB
  Buffers: shared hit=283
  ->  Hash Join  (cost=162.80..755.03 rows=51 width=92) (actual time=0.082..1.120 rows=51.00 loops=1)
        Hash Cond: (x.id = e.exercise_id)
        Buffers: shared hit=283
        ->  Seq Scan on exercises x  (cost=0.00..131.00 rows=6000 width=39) (actual time=0.009..0.369 rows=6000.00 loops=1)
              Buffers: shared hit=71
        ->  Hash  (cost=162.17..162.17 rows=51 width=84) (actual time=0.045..0.047 rows=51.00 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 14kB
              Buffers: shared hit=7
              ->  Subquery Scan on e  (cost=0.56..162.17 rows=51 width=84) (actual time=0.018..0.036 rows=51.00 loops=1)
                    Buffers: shared hit=7
                    ->  Limit  (cost=0.56..161.66 rows=51 width=100) (actual time=0.018..0.031 rows=51.00 loops=1)
                          Buffers: shared hit=7
                          ->  Index Scan Backward using exercise_entries_user_day on exercise_entries e_1  (cost=0.56..71059.16 rows=22495 width=100) (actual time=0.016..0.027 rows=51.00 loops=1)
                                Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                                Index Searches: 1
                                Buffers: shared hit=7
        SubPlan 1
          ->  Aggregate  (cost=8.58..8.59 rows=1 width=8) (actual time=0.003..0.003 rows=1.00 loops=51)
                Buffers: shared hit=205
                ->  Index Only Scan using exercise_entries_user_exercise_day on exercise_entries n  (cost=0.56..8.58 rows=1 width=0) (actual time=0.002..0.003 rows=3.06 loops=51)
                      Index Cond: ((user_id = e.user_id) AND (exercise_id = e.exercise_id) AND (day = e.day) AND (ROW(occurred_at, id) <= ROW(e.occurred_at, e.id)))
                      Heap Fetches: 0
                      Index Searches: 51
                      Buffers: shared hit=205
Planning:
  Buffers: shared hit=6
Planning Time: 0.300 ms
Execution Time: 1.208 ms
```

## Sets next page

```sql
SELECT e.id, e.reps, e.weight_lb, e.occurred_at, e.occurred_tz, e.day,
       (
           SELECT count(*) FROM exercise_entries n
           WHERE n.user_id = e.user_id AND n.exercise_id = e.exercise_id
             AND n.day = e.day
             AND (n.occurred_at, n.id) <= (e.occurred_at, e.id)
       ) AS number,
       x.id AS exercise_id, x.name AS exercise_name,
       x.archived_at IS NOT NULL AS exercise_archived
FROM (
    SELECT * FROM exercise_entries e
    WHERE e.user_id = %(user)s AND true AND (e.day, e.occurred_at, e.id) < (%(cursor_day)s, %(cursor_at)s, %(cursor_id)s)
    ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC
    LIMIT %(limit)s
) e
JOIN exercises x ON x.id = e.exercise_id
ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC

```

```
Sort  (cost=756.67..756.80 rows=51 width=92) (actual time=1.028..1.033 rows=51.00 loops=1)
  Sort Key: e.day DESC, e.occurred_at DESC, e.id DESC
  Sort Method: quicksort  Memory: 30kB
  Buffers: shared hit=283
  ->  Hash Join  (cost=163.00..755.23 rows=51 width=92) (actual time=0.070..1.003 rows=51.00 loops=1)
        Hash Cond: (x.id = e.exercise_id)
        Buffers: shared hit=283
        ->  Seq Scan on exercises x  (cost=0.00..131.00 rows=6000 width=39) (actual time=0.007..0.283 rows=6000.00 loops=1)
              Buffers: shared hit=71
        ->  Hash  (cost=162.36..162.36 rows=51 width=84) (actual time=0.043..0.044 rows=51.00 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 14kB
              Buffers: shared hit=7
              ->  Subquery Scan on e  (cost=0.56..162.36 rows=51 width=84) (actual time=0.016..0.034 rows=51.00 loops=1)
                    Buffers: shared hit=7
                    ->  Limit  (cost=0.56..161.85 rows=51 width=100) (actual time=0.015..0.029 rows=51.00 loops=1)
                          Buffers: shared hit=7
                          ->  Index Scan Backward using exercise_entries_user_day on exercise_entries e_1  (cost=0.56..71018.60 rows=22455 width=100) (actual time=0.015..0.025 rows=51.00 loops=1)
                                Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (ROW(day, occurred_at, id) < ROW('2025-12-29'::date, '2025-12-29 09:30:00+00'::timestamp with time zone, '019b6971-6dc0-78a4-8cd6-bfd0bde36a3b'::uuid)))
                                Index Searches: 1
                                Buffers: shared hit=7
        SubPlan 1
          ->  Aggregate  (cost=8.58..8.59 rows=1 width=8) (actual time=0.003..0.003 rows=1.00 loops=51)
                Buffers: shared hit=205
                ->  Index Only Scan using exercise_entries_user_exercise_day on exercise_entries n  (cost=0.56..8.58 rows=1 width=0) (actual time=0.003..0.003 rows=2.98 loops=51)
                      Index Cond: ((user_id = e.user_id) AND (exercise_id = e.exercise_id) AND (day = e.day) AND (ROW(occurred_at, id) <= ROW(e.occurred_at, e.id)))
                      Heap Fetches: 0
                      Index Searches: 51
                      Buffers: shared hit=205
Planning:
  Buffers: shared hit=6
Planning Time: 0.252 ms
Execution Time: 1.075 ms
```

## Sets of an Exercise

```sql
SELECT e.id, e.reps, e.weight_lb, e.occurred_at, e.occurred_tz, e.day,
       (
           SELECT count(*) FROM exercise_entries n
           WHERE n.user_id = e.user_id AND n.exercise_id = e.exercise_id
             AND n.day = e.day
             AND (n.occurred_at, n.id) <= (e.occurred_at, e.id)
       ) AS number,
       x.id AS exercise_id, x.name AS exercise_name,
       x.archived_at IS NOT NULL AS exercise_archived
FROM (
    SELECT * FROM exercise_entries e
    WHERE e.user_id = %(user)s AND true AND e.exercise_id = %(exercise_id)s
    ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC
    LIMIT %(limit)s
) e
JOIN exercises x ON x.id = e.exercise_id
ORDER BY e.day DESC, e.occurred_at DESC, e.id DESC

```

```
Sort  (cost=574.33..574.42 rows=33 width=92) (actual time=3.815..3.822 rows=51.00 loops=1)
  Sort Key: e.day DESC, e.occurred_at DESC, e.id DESC
  Sort Method: quicksort  Memory: 30kB
  Buffers: shared hit=953
  ->  Hash Join  (cost=136.12..573.50 rows=33 width=92) (actual time=2.840..3.795 rows=51.00 loops=1)
        Hash Cond: (x.id = e.exercise_id)
        Buffers: shared hit=953
        ->  Seq Scan on exercises x  (cost=0.00..131.00 rows=6000 width=39) (actual time=0.008..0.343 rows=6000.00 loops=1)
              Buffers: shared hit=71
        ->  Hash  (cost=135.71..135.71 rows=33 width=84) (actual time=2.797..2.799 rows=51.00 loops=1)
              Buckets: 1024  Batches: 1  Memory Usage: 14kB
              Buffers: shared hit=677
              ->  Subquery Scan on e  (cost=135.29..135.71 rows=33 width=84) (actual time=2.773..2.785 rows=51.00 loops=1)
                    Buffers: shared hit=677
                    ->  Limit  (cost=135.29..135.38 rows=33 width=100) (actual time=2.770..2.777 rows=51.00 loops=1)
                          Buffers: shared hit=677
                          ->  Sort  (cost=135.29..135.38 rows=33 width=100) (actual time=2.769..2.771 rows=51.00 loops=1)
                                Sort Key: e_1.day DESC, e_1.occurred_at DESC, e_1.id DESC
                                Sort Method: top-N heapsort  Memory: 38kB
                                Buffers: shared hit=677
                                ->  Bitmap Heap Scan on exercise_entries e_1  (cost=4.89..134.46 rows=33 width=100) (actual time=0.316..1.605 rows=3128.00 loops=1)
                                      Recheck Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (exercise_id = '01856aa0-c800-7b1b-a5a6-59c5f74bdf59'::uuid))
                                      Heap Blocks: exact=615
                                      Buffers: shared hit=677
                                      ->  Bitmap Index Scan on exercise_entries_user_exercise_day  (cost=0.00..4.88 rows=33 width=0) (actual time=0.196..0.197 rows=3128.00 loops=1)
                                            Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (exercise_id = '01856aa0-c800-7b1b-a5a6-59c5f74bdf59'::uuid))
                                            Index Searches: 1
                                            Buffers: shared hit=62
        SubPlan 1
          ->  Aggregate  (cost=8.58..8.59 rows=1 width=8) (actual time=0.003..0.003 rows=1.00 loops=51)
                Buffers: shared hit=205
                ->  Index Only Scan using exercise_entries_user_exercise_day on exercise_entries n  (cost=0.56..8.58 rows=1 width=0) (actual time=0.002..0.002 rows=3.67 loops=51)
                      Index Cond: ((user_id = e.user_id) AND (exercise_id = e.exercise_id) AND (day = e.day) AND (ROW(occurred_at, id) <= ROW(e.occurred_at, e.id)))
                      Heap Fetches: 0
                      Index Searches: 51
                      Buffers: shared hit=205
Planning:
  Buffers: shared hit=6
Planning Time: 0.279 ms
Execution Time: 3.872 ms
```

## Last N Sessions

```sql
SELECT 1 FROM exercises WHERE id = %(id)s AND user_id = %(user)s
```

```
Index Only Scan using exercises_id_user_id_key on exercises  (cost=0.28..4.30 rows=1 width=4) (actual time=0.010..0.010 rows=1.00 loops=1)
  Index Cond: ((id = '01856aa0-c800-7b1b-a5a6-59c5f74bdf59'::uuid) AND (user_id = '019a0000-0000-7000-8000-000000000001'::uuid))
  Heap Fetches: 0
  Index Searches: 1
  Buffers: shared hit=3
Planning Time: 0.055 ms
Execution Time: 0.021 ms
```

```sql
WITH recent AS (
    SELECT DISTINCT day FROM exercise_entries
    WHERE user_id = %(user)s AND exercise_id = %(exercise)s
    ORDER BY day DESC
    LIMIT %(limit)s
)
SELECT e.day, e.reps, e.weight_lb,
       row_number() OVER (PARTITION BY e.day ORDER BY e.occurred_at, e.id) AS number
FROM exercise_entries e
JOIN recent USING (day)
WHERE e.user_id = %(user)s AND e.exercise_id = %(exercise)s
ORDER BY e.day DESC, number

```

```
Sort  (cost=44.86..44.87 rows=1 width=45) (actual time=0.058..0.060 rows=28.00 loops=1)
  Sort Key: e.day DESC, (row_number() OVER w1)
  Sort Method: quicksort  Memory: 26kB
  Buffers: shared hit=32
  ->  WindowAgg  (cost=44.83..44.85 rows=1 width=45) (actual time=0.044..0.052 rows=28.00 loops=1)
        Window: w1 AS (PARTITION BY e.day ORDER BY e.occurred_at, e.id ROWS UNBOUNDED PRECEDING)
        Storage: Memory  Maximum Storage: 17kB
        Buffers: shared hit=32
        ->  Sort  (cost=44.83..44.83 rows=1 width=37) (actual time=0.042..0.043 rows=28.00 loops=1)
              Sort Key: e.day, e.occurred_at, e.id
              Sort Method: quicksort  Memory: 26kB
              Buffers: shared hit=32
              ->  Nested Loop  (cost=1.11..44.82 rows=1 width=37) (actual time=0.016..0.035 rows=28.00 loops=1)
                    Buffers: shared hit=32
                    ->  Limit  (cost=0.56..1.88 rows=5 width=4) (actual time=0.010..0.014 rows=5.00 loops=1)
                          Buffers: shared hit=5
                          ->  Unique  (cost=0.56..9.30 rows=33 width=4) (actual time=0.010..0.013 rows=5.00 loops=1)
                                Buffers: shared hit=5
                                ->  Index Only Scan Backward using exercise_entries_user_exercise_day on exercise_entries  (cost=0.56..9.21 rows=33 width=4) (actual time=0.009..0.011 rows=22.00 loops=1)
                                      Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (exercise_id = '01856aa0-c800-7b1b-a5a6-59c5f74bdf59'::uuid))
                                      Heap Fetches: 0
                                      Index Searches: 1
                                      Buffers: shared hit=5
                    ->  Index Scan using exercise_entries_user_exercise_day on exercise_entries e  (cost=0.56..8.58 rows=1 width=37) (actual time=0.002..0.003 rows=5.60 loops=5)
                          Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (exercise_id = '01856aa0-c800-7b1b-a5a6-59c5f74bdf59'::uuid) AND (day = exercise_entries.day))
                          Index Searches: 5
                          Buffers: shared hit=27
Planning Time: 0.153 ms
Execution Time: 0.080 ms
```

## Recent Foods

```sql
    SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
    FROM foods c
    LEFT JOIN LATERAL (
    SELECT m.day, m.occurred_at, e.unit AS last_unit, e.quantity AS last_quantity
    FROM food_entries e JOIN meals m ON m.id = e.meal_id
    WHERE e.user_id = c.user_id AND e.food_id = c.id
    ORDER BY m.day DESC, m.occurred_at DESC, e.id DESC
    LIMIT 1
) u ON true
    WHERE c.user_id = %(user)s AND c.archived_at IS NULL
    ORDER BY u.day DESC NULLS LAST, u.occurred_at DESC NULLS LAST, lower(c.name), c.id
    LIMIT %(limit)s

```

```
Limit  (cost=3466.61..3466.64 rows=10 width=82) (actual time=50.591..50.595 rows=10.00 loops=1)
  Buffers: shared hit=49251
  ->  Sort  (cost=3466.61..3467.09 rows=190 width=82) (actual time=50.590..50.593 rows=10.00 loops=1)
        Sort Key: m.day DESC NULLS LAST, m.occurred_at DESC NULLS LAST, (lower(c.name)), c.id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=49251
        ->  Nested Loop Left Join  (cost=30.73..3462.51 rows=190 width=82) (actual time=7.700..50.469 rows=188.00 loops=1)
              Buffers: shared hit=49251
              ->  Bitmap Heap Scan on foods c  (cost=13.83..247.22 rows=190 width=53) (actual time=0.029..0.159 rows=188.00 loops=1)
                    Recheck Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                    Filter: (archived_at IS NULL)
                    Rows Removed by Filter: 12
                    Heap Blocks: exact=3
                    Buffers: shared hit=7
                    ->  Bitmap Index Scan on foods_user_name_key  (cost=0.00..13.79 rows=200 width=0) (actual time=0.017..0.017 rows=200.00 loops=1)
                          Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=4
              ->  Limit  (cost=16.90..16.90 rows=1 width=36) (actual time=0.265..0.265 rows=1.00 loops=188)
                    Buffers: shared hit=49244
                    ->  Sort  (cost=16.90..16.90 rows=1 width=36) (actual time=0.264..0.264 rows=1.00 loops=188)
                          Sort Key: m.day DESC, m.occurred_at DESC, e.id DESC
                          Sort Method: top-N heapsort  Memory: 25kB
                          Buffers: shared hit=49244
                          ->  Nested Loop  (cost=0.85..16.89 rows=1 width=36) (actual time=0.010..0.251 rows=53.39 loops=188)
                                Buffers: shared hit=49244
                                ->  Index Scan using food_entries_user_food on food_entries e  (cost=0.42..8.45 rows=1 width=40) (actual time=0.006..0.049 rows=53.39 loops=188)
                                      Index Cond: ((user_id = c.user_id) AND (food_id = c.id))
                                      Index Searches: 188
                                      Buffers: shared hit=9096
                                ->  Index Scan using meals_id_kind_key on meals m  (cost=0.42..8.44 rows=1 width=28) (actual time=0.003..0.003 rows=1.00 loops=10037)
                                      Index Cond: (id = e.meal_id)
                                      Index Searches: 10037
                                      Buffers: shared hit=40148
Planning:
  Buffers: shared hit=16
Planning Time: 0.337 ms
Execution Time: 50.636 ms
```

## Recent Exercises

```sql
    SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
    FROM exercises c
    LEFT JOIN LATERAL (
    SELECT e.day, e.occurred_at
    FROM exercise_entries e
    WHERE e.user_id = c.user_id AND e.exercise_id = c.id
    ORDER BY e.day DESC, e.occurred_at DESC
    LIMIT 1
) u ON true
    WHERE c.user_id = %(user)s AND c.archived_at IS NULL
    ORDER BY u.day DESC NULLS LAST, u.occurred_at DESC NULLS LAST, lower(c.name), c.id
    LIMIT %(limit)s

```

```
Limit  (cost=225.83..225.85 rows=10 width=76) (actual time=0.460..0.462 rows=10.00 loops=1)
  Buffers: shared hit=237
  ->  Sort  (cost=225.83..225.97 rows=57 width=76) (actual time=0.460..0.461 rows=10.00 loops=1)
        Sort Key: e.day DESC NULLS LAST, e.occurred_at DESC NULLS LAST, (lower(c.name)), c.id
        Sort Method: top-N heapsort  Memory: 26kB
        Buffers: shared hit=237
        ->  Nested Loop Left Join  (cost=5.30..224.59 rows=57 width=76) (actual time=0.041..0.439 rows=58.00 loops=1)
              Buffers: shared hit=237
              ->  Bitmap Heap Scan on exercises c  (cost=4.75..77.11 rows=57 width=55) (actual time=0.022..0.034 rows=58.00 loops=1)
                    Recheck Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                    Filter: (archived_at IS NULL)
                    Rows Removed by Filter: 2
                    Heap Blocks: exact=1
                    Buffers: shared hit=4
                    ->  Bitmap Index Scan on exercises_user_name_key  (cost=0.00..4.73 rows=60 width=0) (actual time=0.013..0.013 rows=60.00 loops=1)
                          Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=3
              ->  Limit  (cost=0.56..2.57 rows=1 width=12) (actual time=0.006..0.006 rows=1.00 loops=58)
                    Buffers: shared hit=233
                    ->  Index Only Scan Backward using exercise_entries_user_exercise_day on exercise_entries e  (cost=0.56..8.63 rows=4 width=12) (actual time=0.006..0.006 rows=1.00 loops=58)
                          Index Cond: ((user_id = c.user_id) AND (exercise_id = c.id))
                          Heap Fetches: 0
                          Index Searches: 58
                          Buffers: shared hit=233
Planning Time: 0.228 ms
Execution Time: 0.485 ms
```

## Recent Restaurants

```sql
    SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
    FROM restaurants c
    LEFT JOIN LATERAL (
    SELECT m.day, m.occurred_at
    FROM meals m
    WHERE m.user_id = c.user_id AND m.restaurant_id = c.id
    ORDER BY m.day DESC, m.occurred_at DESC
    LIMIT 1
) u ON true
    WHERE c.user_id = %(user)s AND c.archived_at IS NULL
    ORDER BY u.day DESC NULLS LAST, u.occurred_at DESC NULLS LAST, lower(c.name), c.id
    LIMIT %(limit)s

```

```
Limit  (cost=139095.34..139095.36 rows=10 width=73) (actual time=41.601..41.605 rows=10.00 loops=1)
  Buffers: shared hit=33267
  ->  Sort  (cost=139095.34..139095.41 rows=28 width=73) (actual time=34.400..34.403 rows=10.00 loops=1)
        Sort Key: m.day DESC NULLS LAST, m.occurred_at DESC NULLS LAST, (lower(c.name)), c.id
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=33267
        ->  Nested Loop Left Join  (cost=4970.73..139094.73 rows=28 width=73) (actual time=2.154..34.356 rows=29.00 loops=1)
              Buffers: shared hit=33267
              ->  Bitmap Heap Scan on restaurants c  (cost=4.51..40.09 rows=28 width=52) (actual time=0.034..0.055 rows=29.00 loops=1)
                    Recheck Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                    Filter: (archived_at IS NULL)
                    Rows Removed by Filter: 1
                    Heap Blocks: exact=1
                    Buffers: shared hit=4
                    ->  Bitmap Index Scan on restaurants_user_name_key  (cost=0.00..4.50 rows=30 width=0) (actual time=0.014..0.015 rows=30.00 loops=1)
                          Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=3
              ->  Limit  (cost=4966.22..4966.22 rows=1 width=12) (actual time=1.175..1.175 rows=1.00 loops=29)
                    Buffers: shared hit=33263
                    ->  Sort  (cost=4966.22..4966.22 rows=1 width=12) (actual time=1.173..1.173 rows=1.00 loops=29)
                          Sort Key: m.day DESC, m.occurred_at DESC
                          Sort Method: top-N heapsort  Memory: 25kB
                          Buffers: shared hit=33263
                          ->  Bitmap Heap Scan on meals m  (cost=217.06..4966.21 rows=1 width=12) (actual time=0.387..1.141 rows=10.00 loops=29)
                                Recheck Cond: (user_id = c.user_id)
                                Filter: (restaurant_id = c.id)
                                Rows Removed by Filter: 3275
                                Heap Blocks: exact=32393
                                Buffers: shared hit=33263
                                ->  Bitmap Index Scan on meals_user_day  (cost=0.00..217.06 rows=3285 width=0) (actual time=0.215..0.215 rows=3285.00 loops=29)
                                      Index Cond: (user_id = c.user_id)
                                      Index Searches: 29
                                      Buffers: shared hit=870
Planning Time: 0.173 ms
JIT:
  Functions: 16
  Options: Inlining false, Optimization false, Expressions true, Deforming true
  Timing: Generation 0.536 ms (Deform 0.242 ms), Inlining 0.000 ms, Optimization 0.352 ms, Emission 6.881 ms, Total 7.769 ms
Execution Time: 42.569 ms
```

## Foods typeahead, short

```sql
    SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
    FROM foods c
    LEFT JOIN LATERAL (
    SELECT m.day, m.occurred_at, e.unit AS last_unit, e.quantity AS last_quantity
    FROM food_entries e JOIN meals m ON m.id = e.meal_id
    WHERE e.user_id = c.user_id AND e.food_id = c.id
    ORDER BY m.day DESC, m.occurred_at DESC, e.id DESC
    LIMIT 1
) u ON true
    WHERE c.user_id = %(user)s AND c.archived_at IS NULL AND lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\'
    ORDER BY lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\' DESC, word_similarity(lower(%(q)s), lower(c.name)) DESC, lower(c.name), c.id
    LIMIT %(limit)s

```

```
Limit  (cost=244.11..244.14 rows=10 width=87) (actual time=1.434..1.437 rows=9.00 loops=1)
  Buffers: shared hit=1047
  ->  Sort  (cost=244.11..244.14 rows=10 width=87) (actual time=1.433..1.435 rows=9.00 loops=1)
        Sort Key: ((lower(c.name) ~~ 'gr%'::text)) DESC, (word_similarity('gr'::text, lower(c.name))) DESC, (lower(c.name)), c.id
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=1047
        ->  Nested Loop Left Join  (cost=57.62..243.94 rows=10 width=87) (actual time=0.577..1.413 rows=9.00 loops=1)
              Buffers: shared hit=1047
              ->  Bitmap Heap Scan on foods c  (cost=40.73..74.62 rows=10 width=53) (actual time=0.130..0.143 rows=9.00 loops=1)
                    Recheck Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (lower(name) ~~ 'gr%'::text))
                    Filter: (archived_at IS NULL)
                    Heap Blocks: exact=3
                    Buffers: shared hit=12
                    ->  BitmapAnd  (cost=40.73..40.73 rows=10 width=0) (actual time=0.119..0.120 rows=0.00 loops=1)
                          Buffers: shared hit=9
                          ->  Bitmap Index Scan on foods_user_name_key  (cost=0.00..13.79 rows=200 width=0) (actual time=0.016..0.016 rows=200.00 loops=1)
                                Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                                Index Searches: 1
                                Buffers: shared hit=4
                          ->  Bitmap Index Scan on foods_name_trgm  (cost=0.00..26.68 rows=1045 width=0) (actual time=0.102..0.102 rows=1001.00 loops=1)
                                Index Cond: (lower(name) ~~ 'gr%'::text)
                                Index Searches: 1
                                Buffers: shared hit=5
              ->  Limit  (cost=16.90..16.90 rows=1 width=36) (actual time=0.135..0.135 rows=1.00 loops=9)
                    Buffers: shared hit=1035
                    ->  Sort  (cost=16.90..16.90 rows=1 width=36) (actual time=0.135..0.135 rows=1.00 loops=9)
                          Sort Key: m.day DESC, m.occurred_at DESC, e.id DESC
                          Sort Method: top-N heapsort  Memory: 25kB
                          Buffers: shared hit=1035
                          ->  Nested Loop  (cost=0.85..16.89 rows=1 width=36) (actual time=0.011..0.124 rows=22.44 loops=9)
                                Buffers: shared hit=1035
                                ->  Index Scan using food_entries_user_food on food_entries e  (cost=0.42..8.45 rows=1 width=40) (actual time=0.006..0.029 rows=22.44 loops=9)
                                      Index Cond: ((user_id = c.user_id) AND (food_id = c.id))
                                      Index Searches: 9
                                      Buffers: shared hit=227
                                ->  Index Scan using meals_id_kind_key on meals m  (cost=0.42..8.44 rows=1 width=28) (actual time=0.004..0.004 rows=1.00 loops=202)
                                      Index Cond: (id = e.meal_id)
                                      Index Searches: 202
                                      Buffers: shared hit=808
Planning:
  Buffers: shared hit=17
Planning Time: 0.419 ms
Execution Time: 1.477 ms
```

## Foods typeahead, typo

```sql
    SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
    FROM foods c
    LEFT JOIN LATERAL (
    SELECT m.day, m.occurred_at, e.unit AS last_unit, e.quantity AS last_quantity
    FROM food_entries e JOIN meals m ON m.id = e.meal_id
    WHERE e.user_id = c.user_id AND e.food_id = c.id
    ORDER BY m.day DESC, m.occurred_at DESC, e.id DESC
    LIMIT 1
) u ON true
    WHERE c.user_id = %(user)s AND c.archived_at IS NULL AND (lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\' OR lower(%(q)s) <%% lower(c.name))
    ORDER BY lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\' DESC, word_similarity(lower(%(q)s), lower(c.name)) DESC, lower(c.name), c.id
    LIMIT %(limit)s

```

```
Limit  (cost=387.82..387.84 rows=10 width=87) (actual time=2.016..2.021 rows=8.00 loops=1)
  Buffers: shared hit=1266
  ->  Sort  (cost=387.82..387.85 rows=12 width=87) (actual time=2.014..2.018 rows=8.00 loops=1)
        Sort Key: ((lower(c.name) ~~ 'chiken%'::text)) DESC, (word_similarity('chiken'::text, lower(c.name))) DESC, (lower(c.name)), c.id
        Sort Method: quicksort  Memory: 26kB
        Buffers: shared hit=1266
        ->  Nested Loop Left Join  (cost=158.33..387.60 rows=12 width=87) (actual time=0.989..2.000 rows=8.00 loops=1)
              Buffers: shared hit=1266
              ->  Bitmap Heap Scan on foods c  (cost=141.43..184.41 rows=12 width=53) (actual time=0.395..0.436 rows=8.00 loops=1)
                    Recheck Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND ((lower(name) ~~ 'chiken%'::text) OR ('chiken'::text <% lower(name))))
                    Filter: ((archived_at IS NULL) AND ((lower(name) ~~ 'chiken%'::text) OR ('chiken'::text <% lower(name))))
                    Rows Removed by Filter: 1
                    Heap Blocks: exact=2
                    Buffers: shared hit=36
                    ->  BitmapAnd  (cost=141.43..141.43 rows=13 width=0) (actual time=0.363..0.365 rows=0.00 loops=1)
                          Buffers: shared hit=34
                          ->  Bitmap Index Scan on foods_user_name_key  (cost=0.00..13.79 rows=200 width=0) (actual time=0.017..0.018 rows=200.00 loops=1)
                                Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                                Index Searches: 1
                                Buffers: shared hit=4
                          ->  BitmapOr  (cost=127.39..127.39 rows=1292 width=0) (actual time=0.343..0.344 rows=0.00 loops=1)
                                Buffers: shared hit=30
                                ->  Bitmap Index Scan on foods_name_trgm  (cost=0.00..56.14 rows=2 width=0) (actual time=0.044..0.044 rows=0.00 loops=1)
                                      Index Cond: (lower(name) ~~ 'chiken%'::text)
                                      Index Searches: 1
                                      Buffers: shared hit=14
                                ->  Bitmap Index Scan on foods_name_trgm  (cost=0.00..71.25 rows=1290 width=0) (actual time=0.299..0.299 rows=714.00 loops=1)
                                      Index Cond: (lower(name) %> 'chiken'::text)
                                      Index Searches: 1
                                      Buffers: shared hit=16
              ->  Limit  (cost=16.90..16.90 rows=1 width=36) (actual time=0.189..0.190 rows=1.00 loops=8)
                    Buffers: shared hit=1230
                    ->  Sort  (cost=16.90..16.90 rows=1 width=36) (actual time=0.189..0.189 rows=1.00 loops=8)
                          Sort Key: m.day DESC, m.occurred_at DESC, e.id DESC
                          Sort Method: top-N heapsort  Memory: 25kB
                          Buffers: shared hit=1230
                          ->  Nested Loop  (cost=0.85..16.89 rows=1 width=36) (actual time=0.015..0.180 rows=30.25 loops=8)
                                Buffers: shared hit=1230
                                ->  Index Scan using food_entries_user_food on food_entries e  (cost=0.42..8.45 rows=1 width=40) (actual time=0.008..0.040 rows=30.25 loops=8)
                                      Index Cond: ((user_id = c.user_id) AND (food_id = c.id))
                                      Index Searches: 8
                                      Buffers: shared hit=262
                                ->  Index Scan using meals_id_kind_key on meals m  (cost=0.42..8.44 rows=1 width=28) (actual time=0.004..0.004 rows=1.00 loops=242)
                                      Index Cond: (id = e.meal_id)
                                      Index Searches: 242
                                      Buffers: shared hit=968
Planning:
  Buffers: shared hit=18
Planning Time: 0.905 ms
Execution Time: 2.079 ms
```

## Exercises typeahead

```sql
    SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
    FROM exercises c
    LEFT JOIN LATERAL (
    SELECT e.day, e.occurred_at
    FROM exercise_entries e
    WHERE e.user_id = c.user_id AND e.exercise_id = c.id
    ORDER BY e.day DESC, e.occurred_at DESC
    LIMIT 1
) u ON true
    WHERE c.user_id = %(user)s AND c.archived_at IS NULL AND (lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\' OR lower(%(q)s) <%% lower(c.name))
    ORDER BY lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\' DESC, word_similarity(lower(%(q)s), lower(c.name)) DESC, lower(c.name), c.id
    LIMIT %(limit)s

```

```
Limit  (cost=103.84..103.86 rows=10 width=81) (actual time=0.222..0.224 rows=6.00 loops=1)
  Buffers: shared hit=29
  ->  Sort  (cost=103.84..103.86 rows=10 width=81) (actual time=0.222..0.223 rows=6.00 loops=1)
        Sort Key: ((lower(c.name) ~~ 'barbel%'::text)) DESC, (word_similarity('barbel'::text, lower(c.name))) DESC, (lower(c.name)), c.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=29
        ->  Nested Loop Left Join  (cost=5.29..103.67 rows=10 width=81) (actual time=0.042..0.210 rows=6.00 loops=1)
              Buffers: shared hit=29
              ->  Bitmap Heap Scan on exercises c  (cost=4.74..77.69 rows=10 width=55) (actual time=0.025..0.143 rows=6.00 loops=1)
                    Recheck Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                    Filter: ((archived_at IS NULL) AND ((lower(name) ~~ 'barbel%'::text) OR ('barbel'::text <% lower(name))))
                    Rows Removed by Filter: 54
                    Heap Blocks: exact=1
                    Buffers: shared hit=4
                    ->  Bitmap Index Scan on exercises_user_name_key  (cost=0.00..4.73 rows=60 width=0) (actual time=0.012..0.012 rows=60.00 loops=1)
                          Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=3
              ->  Limit  (cost=0.56..2.57 rows=1 width=12) (actual time=0.007..0.007 rows=1.00 loops=6)
                    Buffers: shared hit=25
                    ->  Index Only Scan Backward using exercise_entries_user_exercise_day on exercise_entries e  (cost=0.56..8.63 rows=4 width=12) (actual time=0.007..0.007 rows=1.00 loops=6)
                          Index Cond: ((user_id = c.user_id) AND (exercise_id = c.id))
                          Heap Fetches: 0
                          Index Searches: 6
                          Buffers: shared hit=25
Planning:
  Buffers: shared hit=2
Planning Time: 0.491 ms
Execution Time: 0.248 ms
```

## Restaurants typeahead

```sql
    SELECT c.id, c.name, c.archived_at IS NOT NULL AS archived, u.*
    FROM restaurants c
    LEFT JOIN LATERAL (
    SELECT m.day, m.occurred_at
    FROM meals m
    WHERE m.user_id = c.user_id AND m.restaurant_id = c.id
    ORDER BY m.day DESC, m.occurred_at DESC
    LIMIT 1
) u ON true
    WHERE c.user_id = %(user)s AND c.archived_at IS NULL AND (lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\' OR lower(%(q)s) <%% lower(c.name))
    ORDER BY lower(c.name) LIKE lower(%(prefix)s) ESCAPE '\' DESC, word_similarity(lower(%(q)s), lower(c.name)) DESC, lower(c.name), c.id
    LIMIT %(limit)s

```

```
Limit  (cost=9972.89..9972.89 rows=2 width=78) (actual time=4.370..4.373 rows=3.00 loops=1)
  Buffers: shared hit=3445
  ->  Sort  (cost=9972.89..9972.89 rows=2 width=78) (actual time=4.368..4.371 rows=3.00 loops=1)
        Sort Key: ((lower(c.name) ~~ 'kitchn%'::text)) DESC, (word_similarity('kitchn'::text, lower(c.name))) DESC, (lower(c.name)), c.id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=3445
        ->  Nested Loop Left Join  (cost=4970.73..9972.88 rows=2 width=78) (actual time=1.571..4.358 rows=3.00 loops=1)
              Buffers: shared hit=3445
              ->  Bitmap Heap Scan on restaurants c  (cost=4.51..40.38 rows=2 width=52) (actual time=0.049..0.089 rows=3.00 loops=1)
                    Recheck Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                    Filter: ((archived_at IS NULL) AND ((lower(name) ~~ 'kitchn%'::text) OR ('kitchn'::text <% lower(name))))
                    Rows Removed by Filter: 27
                    Heap Blocks: exact=1
                    Buffers: shared hit=4
                    ->  Bitmap Index Scan on restaurants_user_name_key  (cost=0.00..4.50 rows=30 width=0) (actual time=0.012..0.012 rows=30.00 loops=1)
                          Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                          Index Searches: 1
                          Buffers: shared hit=3
              ->  Limit  (cost=4966.22..4966.22 rows=1 width=12) (actual time=1.408..1.408 rows=1.00 loops=3)
                    Buffers: shared hit=3441
                    ->  Sort  (cost=4966.22..4966.22 rows=1 width=12) (actual time=1.406..1.406 rows=1.00 loops=3)
                          Sort Key: m.day DESC, m.occurred_at DESC
                          Sort Method: top-N heapsort  Memory: 25kB
                          Buffers: shared hit=3441
                          ->  Bitmap Heap Scan on meals m  (cost=217.06..4966.21 rows=1 width=12) (actual time=0.434..1.375 rows=8.33 loops=3)
                                Recheck Cond: (user_id = c.user_id)
                                Filter: (restaurant_id = c.id)
                                Rows Removed by Filter: 3277
                                Heap Blocks: exact=3351
                                Buffers: shared hit=3441
                                ->  Bitmap Index Scan on meals_user_day  (cost=0.00..217.06 rows=3285 width=0) (actual time=0.210..0.210 rows=3285.00 loops=3)
                                      Index Cond: (user_id = c.user_id)
                                      Index Searches: 3
                                      Buffers: shared hit=90
Planning:
  Buffers: shared hit=2
Planning Time: 0.518 ms
Execution Time: 4.434 ms
```

## Foods near-duplicate

```sql
SELECT name FROM foods
WHERE id = %(id)s AND user_id = %(user)s
FOR UPDATE

```

```
LockRows  (cost=0.29..8.32 rows=1 width=19) (actual time=0.009..0.009 rows=0.00 loops=1)
  Buffers: shared hit=2
  ->  Index Scan using foods_id_user_id_key on foods  (cost=0.29..8.31 rows=1 width=19) (actual time=0.008..0.008 rows=0.00 loops=1)
        Index Cond: ((id = '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid) AND (user_id = '019a0000-0000-7000-8000-000000000001'::uuid))
        Index Searches: 1
        Buffers: shared hit=2
Planning Time: 0.052 ms
Execution Time: 0.021 ms
```

```sql
SELECT id, name, archived_at IS NOT NULL AS archived
FROM foods
WHERE user_id = %(user)s AND lower(name) = lower(%(name)s) AND id <> %(id)s

```

```
Index Scan using foods_user_name_key on foods  (cost=0.29..8.31 rows=1 width=30) (actual time=0.010..0.010 rows=0.00 loops=1)
  Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (lower(name) = 'baked beanss'::text))
  Filter: (id <> '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid)
  Index Searches: 1
  Buffers: shared hit=2
Planning:
  Buffers: shared hit=1
Planning Time: 0.074 ms
Execution Time: 0.018 ms
```

```sql
SELECT id, name, archived_at IS NOT NULL AS archived
FROM foods
WHERE user_id = %(user)s AND lower(name) %% lower(%(name)s) AND id <> %(id)s
ORDER BY similarity(lower(name), lower(%(name)s)) DESC, lower(name), id
LIMIT %(limit)s

```

```
Limit  (cost=115.64..115.64 rows=1 width=66) (actual time=4.496..4.498 rows=1.00 loops=1)
  Buffers: shared hit=257
  ->  Sort  (cost=115.64..115.64 rows=1 width=66) (actual time=4.494..4.495 rows=1.00 loops=1)
        Sort Key: (similarity(lower(name), 'baked beanss'::text)) DESC, (lower(name)), id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=257
        ->  Bitmap Heap Scan on foods  (cost=108.14..115.63 rows=1 width=66) (actual time=0.814..4.485 rows=1.00 loops=1)
              Recheck Cond: (lower(name) % 'baked beanss'::text)
              Rows Removed by Index Recheck: 1274
              Filter: ((id <> '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid) AND (user_id = '019a0000-0000-7000-8000-000000000001'::uuid))
              Rows Removed by Filter: 32
              Heap Blocks: exact=227
              Buffers: shared hit=257
              ->  Bitmap Index Scan on foods_name_trgm  (cost=0.00..108.14 rows=2 width=0) (actual time=0.751..0.752 rows=1307.00 loops=1)
                    Index Cond: (lower(name) % 'baked beanss'::text)
                    Index Searches: 1
                    Buffers: shared hit=30
Planning:
  Buffers: shared hit=1
Planning Time: 0.461 ms
Execution Time: 4.532 ms
```

## Exercises near-duplicate

```sql
SELECT name FROM exercises
WHERE id = %(id)s AND user_id = %(user)s
FOR UPDATE

```

```
LockRows  (cost=0.28..8.31 rows=1 width=21) (actual time=0.006..0.011 rows=0.00 loops=1)
  Buffers: shared hit=2
  ->  Index Scan using exercises_id_user_id_key on exercises  (cost=0.28..8.30 rows=1 width=21) (actual time=0.006..0.010 rows=0.00 loops=1)
        Index Cond: ((id = '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid) AND (user_id = '019a0000-0000-7000-8000-000000000001'::uuid))
        Index Searches: 1
        Buffers: shared hit=2
Planning Time: 0.041 ms
Execution Time: 0.020 ms
```

```sql
SELECT id, name, archived_at IS NOT NULL AS archived
FROM exercises
WHERE user_id = %(user)s AND lower(name) = lower(%(name)s) AND id <> %(id)s

```

```
Index Scan using exercises_user_name_key on exercises  (cost=0.28..8.30 rows=1 width=32) (actual time=0.008..0.008 rows=0.00 loops=1)
  Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (lower(name) = 'barbell curls'::text))
  Filter: (id <> '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid)
  Index Searches: 1
  Buffers: shared hit=2
Planning:
  Buffers: shared hit=1
Planning Time: 0.084 ms
Execution Time: 0.017 ms
```

```sql
SELECT id, name, archived_at IS NOT NULL AS archived
FROM exercises
WHERE user_id = %(user)s AND lower(name) %% lower(%(name)s) AND id <> %(id)s
ORDER BY similarity(lower(name), lower(%(name)s)) DESC, lower(name), id
LIMIT %(limit)s

```

```
Limit  (cost=77.56..77.56 rows=1 width=68) (actual time=0.209..0.209 rows=1.00 loops=1)
  Buffers: shared hit=4
  ->  Sort  (cost=77.56..77.56 rows=1 width=68) (actual time=0.208..0.208 rows=1.00 loops=1)
        Sort Key: (similarity(lower(name), 'barbell curls'::text)) DESC, (lower(name)), id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=4
        ->  Bitmap Heap Scan on exercises  (cost=4.73..77.55 rows=1 width=68) (actual time=0.063..0.202 rows=1.00 loops=1)
              Recheck Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Filter: ((id <> '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid) AND (lower(name) % 'barbell curls'::text))
              Rows Removed by Filter: 59
              Heap Blocks: exact=1
              Buffers: shared hit=4
              ->  Bitmap Index Scan on exercises_user_name_key  (cost=0.00..4.73 rows=60 width=0) (actual time=0.012..0.012 rows=60.00 loops=1)
                    Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                    Index Searches: 1
                    Buffers: shared hit=3
Planning:
  Buffers: shared hit=1
Planning Time: 0.401 ms
Execution Time: 0.229 ms
```

## Restaurants near-duplicate

```sql
SELECT name FROM restaurants
WHERE id = %(id)s AND user_id = %(user)s
FOR UPDATE

```

```
LockRows  (cost=0.28..8.31 rows=1 width=18) (actual time=0.007..0.007 rows=0.00 loops=1)
  Buffers: shared hit=2
  ->  Index Scan using restaurants_id_user_id_key on restaurants  (cost=0.28..8.30 rows=1 width=18) (actual time=0.006..0.006 rows=0.00 loops=1)
        Index Cond: ((id = '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid) AND (user_id = '019a0000-0000-7000-8000-000000000001'::uuid))
        Index Searches: 1
        Buffers: shared hit=2
Planning Time: 0.042 ms
Execution Time: 0.016 ms
```

```sql
SELECT id, name, archived_at IS NOT NULL AS archived
FROM restaurants
WHERE user_id = %(user)s AND lower(name) = lower(%(name)s) AND id <> %(id)s

```

```
Index Scan using restaurants_user_name_key on restaurants  (cost=0.28..8.30 rows=1 width=29) (actual time=0.007..0.007 rows=0.00 loops=1)
  Index Cond: ((user_id = '019a0000-0000-7000-8000-000000000001'::uuid) AND (lower(name) = 'blue bistros'::text))
  Filter: (id <> '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid)
  Index Searches: 1
  Buffers: shared hit=2
Planning:
  Buffers: shared hit=1
Planning Time: 0.055 ms
Execution Time: 0.015 ms
```

```sql
SELECT id, name, archived_at IS NOT NULL AS archived
FROM restaurants
WHERE user_id = %(user)s AND lower(name) %% lower(%(name)s) AND id <> %(id)s
ORDER BY similarity(lower(name), lower(%(name)s)) DESC, lower(name), id
LIMIT %(limit)s

```

```
Limit  (cost=40.32..40.33 rows=1 width=65) (actual time=0.088..0.089 rows=1.00 loops=1)
  Buffers: shared hit=4
  ->  Sort  (cost=40.32..40.33 rows=1 width=65) (actual time=0.088..0.088 rows=1.00 loops=1)
        Sort Key: (similarity(lower(name), 'blue bistros'::text)) DESC, (lower(name)), id
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=4
        ->  Bitmap Heap Scan on restaurants  (cost=4.51..40.31 rows=1 width=65) (actual time=0.041..0.083 rows=1.00 loops=1)
              Recheck Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
              Filter: ((id <> '01a1b4d0-4702-74dc-bafb-73e7e5c5a349'::uuid) AND (lower(name) % 'blue bistros'::text))
              Rows Removed by Filter: 29
              Heap Blocks: exact=1
              Buffers: shared hit=4
              ->  Bitmap Index Scan on restaurants_user_name_key  (cost=0.00..4.50 rows=30 width=0) (actual time=0.009..0.009 rows=30.00 loops=1)
                    Index Cond: (user_id = '019a0000-0000-7000-8000-000000000001'::uuid)
                    Index Searches: 1
                    Buffers: shared hit=3
Planning:
  Buffers: shared hit=1
Planning Time: 0.304 ms
Execution Time: 0.103 ms
```
