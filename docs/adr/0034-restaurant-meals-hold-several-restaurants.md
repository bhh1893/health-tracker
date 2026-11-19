---
status: accepted
---

# Restaurant Meals hold one to ten Restaurants

A Restaurant Meal holds an ordered list of one to ten Restaurants instead of exactly one, so a food hall or a night of bar hopping is logged as the single eating occasion it was. A Meal still holds Food Entries or Restaurants, never both. Decided in [Several Restaurants in one Meal](https://github.com/bhh1893/health-tracker/issues/271). It amends ADR 0002 and ADR 0008.

## Shape

### Data

- **`meal_restaurants`** replaces `meals.restaurant_id`: `(id uuidv7, user_id, meal_id, meal_kind, restaurant_id, logged_at, updated_at)`. It copies `food_entries`' pattern: `meal_kind` is always `'restaurant'`, and the composite FK `(meal_id, meal_kind) -> meals (id, kind)` makes a Restaurant on a foods Meal impossible. `(meal_id, user_id) -> meals` and `(restaurant_id, user_id) -> restaurants` keep ownership; both Meal FKs cascade, the Restaurant FK restricts, as for Food Entries.
- **`UNIQUE (meal_id, restaurant_id)`:** a Restaurant appears once per Meal.
- **Order is the order sent.** Saving a Meal deletes and re-inserts its rows in request order, and reads sort by `id` (UUIDv7, monotonic within a connection on Postgres 18). No `position` column. Food Entries already work this way; a test now pins it for both kinds.
- **"At least one Restaurant"** moves from the `meals_restaurant_matches_kind` CHECK to the API, alongside the existing "at least one Food Entry" rule (ADR 0002: kept API-only where the database cannot enforce cheaply).
- **One time per Meal.** `occurred_at` defaults to when the Meal is logged; the User may edit it to the first or last stop. There is no time per Restaurant.
- **Migration, expand then contract:** the first migration creates `meal_restaurants` and copies every `restaurant_id` into it. A later migration, once no running `api` reads the column, drops `meals.restaurant_id` and its CHECK.

### API (additive within `/api/v1`, ADR 0006)

- `PUT /meals/{id}` with `kind: "restaurant"` accepts `restaurant_ids: [uuid]`: 1 to 10, no duplicates, order kept. Duplicates and an empty or oversized list are `422`.
- The old `restaurant_id: uuid` is still accepted and means `restaurant_ids: [restaurant_id]`. Sending both is `422`. If the stored Meal holds more than one Restaurant, a `PUT` with `restaurant_id` is `409`, so an old client cannot silently shrink it.
- A Restaurant Meal read gains `restaurants: [CatalogRef]` in order. `restaurant` stays and is the first of them. Both old fields are marked `deprecated` in the OpenAPI contract and removed only in a `/api/v2`.
- `MAX_RESTAURANTS = 10`. Food Entries keep `MAX_FOOD_ENTRIES = 100`: a home-cooked Meal can list more than ten Foods, ten Restaurants in one sitting is already a lot, and each kind's cap fits its own use.
- `GET /meal-days?q=` (ADR 0033) matches a Day when any of a Meal's Restaurants matches. Recent-Restaurant ordering counts every Restaurant of a Meal as used.

### Meal sheet (ADR 0008)

- Restaurant mode becomes a list like Foods: the Restaurant search plus recent-Restaurant chips add to an ordered list, each row removable. Save needs at least one.
- A Meal card and History show every Restaurant in orange, in order, wrapping as needed.
- Reordering a Meal's Restaurants or Foods is left for later. Because order is whatever the client sends, it needs no API change.

### Unchanged

- **Restaurant Day** (ADR 0023): a Day with at least one Restaurant Meal, counted at the User's flat value. Two Restaurants in one Meal and two Restaurant Meals give the same Day.
- Kind is still immutable, and a Meal never mixes Foods and Restaurants.

## Considered Options

- **Keep one Restaurant per Meal and log one Meal per stop.** The numbers come out the same, since Restaurant Days are flat. Rejected: a food hall or bar crawl is one eating occasion, and splitting it makes the log say otherwise.
- **Let a Meal mix Food Entries and Restaurants.** Not needed: the owner never combines them in one Meal, and dropping the kind rule would weaken the database guarantee ADR 0002 chose.
- **A time per Restaurant.** Rejected: it turns each Restaurant into a second kind of Entry. If the time of each stop matters, the stops are separate Meals.
- **A `position` column.** Not needed: Meals are replaced whole, so insert order already carries the order. It would only matter if rows were edited one at a time.
- **Rename `restaurant` to `restaurants` in place.** Rejected by ADR 0006: within v1 only additive changes. Old fields stay, deprecated.
- **Lower the Food Entries cap to 10 to match.** Rejected: see the caps above.

## Consequences

- One more table, and one fewer invariant the database enforces on its own: a Restaurant Meal with no Restaurants is prevented only by the API.
- Order depends on how ids are generated, not on a visible column. The test is the guard; if rows ever become editable one at a time, add `position`.
- `restaurant_id` and `restaurant` live on as deprecated v1 fields. An old client sees only the first Restaurant, and is refused rather than allowed to drop the others.
- Three deploys: `api` expands (table, backfill, both fields), `web` moves to the list, `api` contracts (drops the column). Between the first and the last, `api` writes the first Restaurant to `meals.restaurant_id` as well, so a pod still running the old version reads a correct Meal during a rollout.
