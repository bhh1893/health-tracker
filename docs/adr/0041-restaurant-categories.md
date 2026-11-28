---
status: proposed
---

# Restaurants have a Category: ate out, drinks or dessert

Every Restaurant gets one Category, **ate out**, **drinks** or **dessert**, separate from the Meal's label. A new Restaurant starts as ate out; the User changes it on the Restaurant's sheet in Profile. The Category is shown and filtered on, and changes no number: a Restaurant Day still counts as the User's flat Restaurant Day calories whatever its Categories. It amends ADR 0008, ADR 0032 and ADR 0033.

## Shape

### Data

- **`restaurants.category text NOT NULL DEFAULT 'ate_out'`**, with `CHECK (category IN ('ate_out', 'drinks', 'dessert'))`. Postgres 11+ stores a constant default once instead of rewriting rows, so the migration is instant and every existing Restaurant becomes ate out.
- **One migration, no contract step.** The column only adds; nothing old stops being read.
- **The Category belongs to the Restaurant, not the Meal.** A Meal's Categories are its Restaurants' Categories.

### API (additive within `/api/v1`, ADR 0006)

- A Restaurant, from `GET /restaurants`, `GET /restaurants/{id}` and its writes, gains `category: "ate_out" | "drinks" | "dessert"`.
- `PUT /restaurants/{id}` accepts an optional `category`, default `ate_out`. Logging creates Restaurants this way and never sends it. `PATCH /restaurants/{id}` accepts `category` beside `name` and `archived`. Any other value is `422`.
- A Restaurant Meal's `restaurants` entries gain `category`, so a Meal is drawn without a second request. Foods and Exercises keep the plain `CatalogRef`.
- `GET /meal-days` gains `category`, one value. It keeps the Days with at least one Restaurant of that Category. With `q`, a Day must match both.

### Profile (ADR 0032)

- **The Restaurant sheet** gains a Category picker under the name: a three-option segmented control, Ate out | Drinks | Dessert. Save sends it with the name in one `PATCH`.
- **The Restaurants page** shows each row's Category as a tag, and gains Ate out | Drinks | Dessert filter chips in the URL (`?category=`), filtered in the browser like the search box.

### Showing it (ADR 0008, ADR 0033)

- **A Meal card and History** show each Restaurant's Category next to its name, as a small tag.
- **A Restaurant Day's badge** in Recent Days and the Day total names the Day's Categories in a fixed order, e.g. "drinks" or "ate out, dessert", instead of always "ate out".
- **History's Meals tab** gains the same three chips beside the filter field, as `?category=` in the URL. Like `q`, it narrows Recent Days and never the Dashboard.
- **The chart and tiles** say "restaurant" where they said "ate out", since they count Restaurant Days of any Category.

## Considered Options

- **The Category on the Meal.** One place can be dinner one night and drinks the next. Rejected for now: the owner asked for it on the Restaurant, and set once per place it costs nothing at logging time. If a place often changes role, a per-Meal override can be added later without breaking this.
- **A Postgres enum type.** Rejected: adding a value needs `ALTER TYPE`, and removing one means rebuilding the type. A `CHECK` on `text` changes with one ordinary migration.
- **User-defined Categories (a `restaurant_categories` table).** Rejected: the owner named three, and fixed values let the client draw chips and tags without asking.
- **Flat calories per Category** (e.g. drinks 600, dessert 500). Rejected by the owner for now. It is the natural next step, and this data model already supports it.
- **A Profile setting for which Category new Restaurants start as.** Not needed: almost every new Restaurant is somewhere to eat.

## Consequences

- **A drinks-only or dessert-only Day is still a Restaurant Day**, counted at the full flat calories (ADR 0023). The new badge at least says why a Day ran high.
- Every existing Restaurant starts as ate out. Bars and dessert shops must be changed by hand once in Profile.
- A Restaurant's Category is current, not historical: changing it relabels every past Meal there, the same way renaming does.
- Two deploys, in order: `api` (column, fields, filter), then `web`. `web` deployed first would send `?category=` to an `api` that ignores it.
