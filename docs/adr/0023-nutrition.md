---
status: accepted
---

# Nutrition: per-User values on each Food, a hand-curated reference list for prefill, Day totals computed on the server

A Food gains optional Nutrition: calories, protein, carbs and fat for a Basis amount in grams, entered as printed on the label, plus an optional Piece Weight that turns a count into grams. Totals are never stored. `GET /days` computes them on read, so correcting a Food fixes every past Day. A Day with a Restaurant Meal is a Restaurant Day: its calories become a flat per-User value and its macros are unknown. Reference Foods, a list the owner curates in the repo and every deploy loads, only prefill a User's Food by copying values. Decided in [Macros and calories for Foods](https://github.com/bhh1893/health-tracker/issues/128). This amends ADR 0002, ADR 0006 and ADR 0008.

**Amended by ADR 0032:** the Food sheet opens only from Profile's Foods page, not from the Meal sheet; the Incomplete badge links to that page filtered to Foods with no Nutrition, instead of listing the Day's Foods.

## Shape

### Nutrition on a Food

- New nullable columns on `foods`: `basis_g`, `kcal`, `protein_g`, `carbs_g`, `fat_g` (all `numeric`), and `piece_g`.
- **All or nothing.** A CHECK requires the five Nutrition columns to be all null or all set. Piece Weight is independent.
- **Bounds:** `basis_g > 0`; each macro between 0 and `basis_g`; `kcal` between 0 and 10,000; `piece_g > 0`. _Amended during the build ([#157](https://github.com/bhh1893/health-tracker/issues/157)): the API also asks for `basis_g >= 0.001` and caps `basis_g` and `piece_g` at 1,000,000. A total divides by the Basis, so a Basis near zero could exceed what a JSON number holds. The CHECKs are unchanged._
- **Calories are stored, not derived** from 4/4/9 kcal per gram: labels do not follow that formula exactly (fibre, alcohol, rounding).
- **Stored as typed.** A label reading "per 60 g serving: 250 kcal" is saved as `basis_g = 60, kcal = 250`, so reopening the Food shows the label's numbers. A Food Entry of `q` grams contributes `q / basis_g × value`. A count Entry first becomes `q × piece_g` grams.
- **No backfill.** Existing Foods start without Nutrition. Creating a Food from the combobox stays one tap and sets none.
- In scope: calories and the three macros. Out: fibre, sodium and daily targets. Each is additive later (nullable columns, or its own feature).

### Day totals

- **Computed on read, never stored.** A Day's totals are the sum over its Food Entries of the formula above, using each Food's current Nutrition.
- **Incomplete Day:** some Food Entry's Food has no Nutrition, or a count Entry's Food has no Piece Weight. The total still sums what is known and carries `incomplete: true`.
- **Restaurant Day:** a Day with at least one Restaurant Meal. Derived, never toggled. Its `kcal` is the User's `restaurant_day_kcal`, whatever else was logged; its macros are null, never 0, so no average or chart mistakes them for real values. A Restaurant Day is never Incomplete.
- `restaurant_day_kcal` is a new `users` column, `numeric`, not null, default 5000, between 0 and 10,000. Computed on read like the rest, so changing it changes every past Restaurant Day.
- Restaurant Meals carry no Nutrition of their own.

### Reference Foods

- A `reference_foods` table: `id` (UUID), `name`, the same Nutrition and `piece_g` columns and bounds, Nutrition required. `pg_trgm` index on `lower(name)`, as for the Catalogs (ADR 0012).
- **Not owned:** no `user_id`, the first table outside ADR 0002's ownership rule. That is safe because `api` only reads it (the migration revokes `INSERT`, `UPDATE` and `DELETE` on it from `api_rw`) and no row points at it: "Fill from reference" copies Nutrition and Piece Weight into the User's Food, never a foreign key and never the name. A later edit to a Reference Food changes no User's data.
- **Source of truth:** `services/api/data/reference_foods.csv` (owned by `api`, ADR 0003) (`id, name, basis_g, kcal, protein_g, carbs_g, fat_g, piece_g`), curated by hand and reviewed in PRs. Generic nutrition values are not personal data, so the public repo (ADR 0017) is fine.
- **Loading:** the CSV ships in the `api` image, and the migration Job (ADR 0016) loads it after `alembic upgrade head`, as the owner role `app` (ADR 0015). It upserts every row by `id` (`INSERT ... ON CONFLICT (id) DO UPDATE`) and deletes rows whose `id` is no longer in the file, in one transaction. Running it twice changes nothing, so it runs on every deploy. Curation stays manual: edit the CSV, open a PR, and the next deploy loads it.
- No import of USDA FoodData Central or Open Food Facts, and no Admin UI.

### API (additive within `/api/v1`, ADR 0006)

- `/foods/{id}` gains `nutrition: {basis_g, kcal, protein_g, carbs_g, fat_g} | null` and `piece_g: number | null`, settable through `PUT` and `PATCH`. A partial `nutrition` object is `422`.
- `GET /reference-foods?q=&limit=10` (`suggest_reference_foods`): read-only typeahead, same ranking and debounce as Catalog suggestions.
- `GET /days?from=&to=` (`list_days`): one row per Day in the range that has a Meal, newest first, `{day, kcal, protein_g, carbs_g, fat_g, restaurant_day, incomplete}`. `from`/`to` are inclusive Days, at most 366 apart; no pagination. This is the server summary ADR 0013 named as the additive fix, and Dashboards ([#129](https://github.com/bhh1893/health-tracker/issues/129)) and the future MCP wrapper reuse it. Days without Meals are omitted.
- `GET`/`PATCH /api/me` gains `restaurant_day_kcal`.
- Per-Meal totals on Meal reads are out of the first cut; a computed field later is additive. _Amended by ADR 0024: a foods Meal now carries `total`, for Search._
- _Added during the build ([#157](https://github.com/bhh1893/health-tracker/issues/157)): `/api/me` did not exist yet (it is ADR 0021's, built in [#151](https://github.com/bhh1893/health-tracker/issues/151)). It ships here with `restaurant_day_kcal` only, at `/api/me` as written, outside `/api/v1`. `role` and `name` are additive when #151 lands._

### UI (amends ADR 0008)

- **Food sheet**, new: name, the Nutrition block (Basis, kcal, protein, carbs, fat), Piece Weight, and "Fill from reference", a `ComboBox` over `GET /reference-foods` that copies values into the form. Save sends one `PATCH /foods/{id}`.
- Opened from a Food Entry's name in the Meal sheet, or from the Incomplete badge on the Day total.
- **Day total** in the Meals window header, from `GET /days?from=day&to=day`. An Incomplete Day shows a badge; tapping it lists the Day's Foods missing Nutrition or Piece Weight, each opening its Food sheet. A Restaurant Day is marked as such.
- No "manage Foods" screen in the first cut.
- How charts draw Restaurant Days (a spike at the flat value, in a distinct style) is decided in #129.

## Considered Options

- **A shared public Food catalog, or a hybrid of shared and private Foods.** Rejected: someone must moderate edits and wrong data, names clash with private Foods, and every read must merge two sources. ADR 0002 rejected a global Catalog for the same reasons. Copy-on-pick prefill gives the convenience without shared mutable rows.
- **Importing USDA FoodData Central** (generic foods, public domain) **or Open Food Facts** (branded, millions of rows, ODbL share-alike). Not chosen: the owner prefers a small list they curate and trust. Either can feed the same CSV later.
- **Calling a nutrition API live at search time.** Rejected: every search depends on a third party and outbound network access from the cluster, and FoodData Central needs an API key, which is another secret.
- **Loading by hand with `kubectl exec` into `api`**, like the users command (ADR 0022). Rejected: the loader would run as `api_rw`, which would then need write access to the table, and every rebuild or restore would need the owner to remember the step.
- **Editing `reference_foods` directly with `psql`.** Rejected: the data would live only in the database, with no history or review, and would survive a full rebuild ([#58](https://github.com/bhh1893/health-tracker/issues/58)) only through a backup restore.
- **Snapshot macros on each Food Entry.** Rejected: history never moves, but a typo stays wrong forever unless every affected Meal is re-saved, and `food_entries` gains four columns. Computing on read follows ADR 0002's "derive, never store". The cost: when a product is reformulated, editing its Food rewrites the past too. Create a new Food instead.
- **Two sets of values per Food (per 100 g and per item).** Rejected: entered twice, and the two can disagree. One Basis plus Piece Weight covers both ways of logging.
- **Converting entered values to per 100 g.** Rejected: reopening the Food shows numbers that are on no label, plus rounding drift.
- **A manual estimate on each Restaurant Meal, or a default per Restaurant.** Not chosen: the owner wants Restaurant Days to stand out as off the trend rather than to look precise, and a single flat value says that honestly.
- **Restaurant Day macros as 0.** Rejected: 0 g of protein reads as real data and pulls down every average.
- **Day totals computed in the client**, as Search does (ADR 0013). Rejected: the Restaurant Day rule would be repeated in every client, and long Dashboard ranges would download every Food Entry.

## Consequences

- `GET /days` aggregates Food Entries for a range on every read. ADR 0012's `(user_id, day)` feed indexes serve the range; record its plan in the plans file when it is built, and add a summary table only if a measured plan says so.
- An Incomplete Day under-reports calories, and the badge is the only signal. Filling in Nutrition is a habit the UI nudges toward, not a rule it enforces.
- Editing a Food's Nutrition silently changes past Days. That is the intended behaviour for corrections, and the wrong one for reformulations.
- New Reference Food values go live only with a deploy of `api`, and a CSV-only change still builds a new image. Acceptable for a list that changes rarely.
- A malformed CSV fails the migration Job, which stops the rollout (ADR 0016) with the old pods still serving. CI must validate the CSV (columns, bounds, unique `id`) so this is caught in the PR.
- The migration Job now changes data as well as schema; keep the loader idempotent and fast, since it runs on every deploy.
