---
status: accepted
---

# Data model: per-user rows, database-enforced invariants, derived groupings

Postgres holds one row per fact, owned by a user, with the database (not only the API) rejecting cross-user links and malformed Meals. Anything derivable (Meal number, Set number, Session, a Food's default unit) is computed at read time, never stored. v1 has one user, but adding a `user_id` and same-owner constraints later would mean backfilling every table and auditing every query, so we pay for it now.

## Shape

- Tables: `users`; one table per Catalog (`foods`, `exercises`, `restaurants`); `meals`; `food_entries`; `exercise_entries`. No `sessions` table.
- Keys: UUIDv7 everywhere (Postgres 18+ `uuidv7()`): unguessable in URLs, yet time-ordered so index inserts stay local.
- Ownership: every owned row has `user_id`. Parents expose `UNIQUE (id, user_id)` and children reference them with composite FKs like `(food_id, user_id) -> foods (id, user_id)`, so a row can only point at rows with the same owner.
- Meal kind: `meals.kind` is `'foods'` or `'restaurant'`; a CHECK ties `restaurant_id` to it, and `food_entries (meal_id, meal_kind = 'foods') -> meals (id, kind)` makes a Food Entry on a Restaurant Meal impossible. Kind is immutable.
- Day: `occurred_at timestamptz` + `occurred_tz` (IANA name) + `day date`, the last computed by the API on every write. Not a generated column: timezone conversion is not immutable in Postgres. A Day never moves when the user later travels.
- Deletes: Meals and Entries are hard-deleted (Meal cascades to Food Entries). Catalog items are archived (`archived_at`); FKs from Entries are `ON DELETE RESTRICT`, so only never-used items can be hard-deleted.
- Catalog names: unique per user on `lower(name)`, including archived items; the API trims and collapses whitespace and offers to unarchive instead of duplicating.
- Edits: current state only, with `logged_at` (immutable) and `updated_at`; no history tables.

## Considered Options

- **`bigint` identity keys.** Rejected: enumerable IDs invite IDOR once there are several users and leak row counts.
- **One global Catalog shared by all users.** Rejected: rename and typo conflicts between users; per-user rows are cheap and are independent facts, not duplicates.
- **One polymorphic `catalog_items` table, or one `entries` table (single-table inheritance).** Rejected: FKs can no longer guarantee an Entry points at the right kind, and the kinds will diverge.
- **One timezone per user.** Rejected: travelling would silently move past Entries to other Days.
- **Soft delete for Entries.** Rejected: every query must filter `deleted_at` forever; backups cover mistakes.
- **Stored Meal numbers and a `sessions` table.** Rejected: both are derivable, and storing them creates sync bugs (renumbering, orphan Sessions). A `sessions` table can be added later with a one-statement backfill if a Session ever needs facts of its own.
- **API-only invariants.** Rejected for ownership and Meal kind: one bug or manual fix could corrupt data. Kept API-only where the database cannot enforce cheaply: a Food-Entries Meal has at least one Food Entry.

## Consequences

- Composite FKs protect writes, not reads: a query that forgets `WHERE user_id` still leaks. Row-Level Security is the v2 answer once there is a second user.
- Postgres placement must provide Postgres 18 or newer.
- Indexes (`(user_id, day)`, `(user_id, exercise_id, day)`, `pg_trgm` on names) are decided in the query-performance work, not here.
