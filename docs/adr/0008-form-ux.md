---
status: accepted
---

# Form UX: two Day feeds with bottom sheets, Tailwind + React Aria, recently-used suggestions

`web` (ADR 0007) has two windows, **Exercise** and **Meals**, each a feed of the Day's Sessions or Meals; every add or edit opens a bottom sheet over the feed. It is styled with Tailwind CSS and built on React Aria Components, which supply the accessible combobox, dialogs and keyboard behaviour while we own the look. Chosen from four clickable variants on a phone ([Form UX prototype](https://github.com/bhh1893/health-tracker/issues/14), branch `prototype/form-ux`, Variant D). The feed won because the most common action, logging the next Set, is one tap from what is already on screen.

## Shape

- **Windows:** a segmented control switches Exercise and Meals. Both show the Day being viewed (today in v1). Restaurant is a mode inside the Meal sheet, not a third window: a Restaurant Meal is still a Meal.
- **Session card:** Sets listed in order, numbered at read time. Header: **Edit** and a trash can. Footer, two buttons:
  - dashed `+ 135 lb × 5`: one tap duplicates the previous Set (new id, Occurred At now);
  - solid `+ Set N`: opens the Set sheet with this Exercise and the previous weight and reps prefilled.
- **Set sheet:** row 1 Time | Exercise, row 2 Weight | Reps (blank weight = bodyweight). Save in a fixed footer.
- **Edit Session sheet:** every Set of the Session editable in place, with per-row delete and undo. Save sends one `PUT` per changed Set and one `DELETE` per removed Set; unchanged Sets send nothing.
- **Delete Exercise for the Day:** a confirm sheet listing the Sets, then one `DELETE` per Set. There is no Session resource: a Session is derived.
- **Meal card:** tap opens the Meal sheet in edit mode, with Delete Meal.
- **Meal sheet:** top to bottom: Foods | Restaurant toggle; Time | Label; the Meal's Food Entries (quantity and g/count editable inline), the only part that scrolls. Fixed footer: food search (2/3) + **Add** (1/3), recent-Food chips in one horizontal row, Save. Picking a suggestion selects it; **Add** commits it to the Meal. Restaurant mode swaps the Food Entries for a Restaurant search plus recent-Restaurant chips.
- **Time:** a time-only input; the date is the Day being viewed. Occurred At defaults to now.
- **Catalog search:** React Aria `ComboBox`, suggestions from `GET /{kind}s?q=` (ADR 0006) with a ~150 ms debounce. A trailing `+ Create "<text>"` row creates the item first, so the near-duplicate `409` can open a "Did you mean?" dialog (use existing, unarchive, or create anyway) before the Entry is saved.
- **Partial failure:** a sheet that sends several requests (Edit Session, Delete Exercise) stays open on any failure and keeps the unsent rows; retrying is safe because every `PUT` and `DELETE` is idempotent.
- **Styling:** Tailwind CSS v4 utility classes in the markup; React Aria's `data-*` state attributes (`data-focused`, `data-selected`) drive state styles. Inputs use at least 16 px text so iOS Safari does not zoom on focus.

## Additive change to ADR 0006: recently-used suggestions

`GET /foods?q=&limit=` with an **empty `q`** returns the user's Foods ordered by most recent use (latest Occurred At of an Entry referring to them), then never-used Foods by name; archived excluded. Each Food also carries `last_quantity` beside the existing `last_unit`. `/restaurants` and `/exercises` behave the same (without quantity). This feeds the recent chips and the combobox's on-focus list. It is additive within `/api/v1`: a non-empty `q` behaves as before.

## Considered Options

- **Variant A, one form with Set / Meal / Restaurant tabs.** Not chosen: familiar, but every Set starts from an empty-looking form and the Day's context is off screen.
- **Variant B, one step per screen with steppers.** Not chosen: big targets, but four or five taps per Set where the feed needs one.
- **Variant C, one combined feed.** Became D: the user wanted Exercise and Meals apart, and an edit view showing every Set rather than only the last.
- **MUI or another styled component kit.** Rejected: ships its own look, which we would fight on mobile, and a heavier bundle.
- **shadcn/ui (Radix + Tailwind).** Not chosen: Radix has no combobox, the one hard component here.
- **Headless UI or Downshift for the combobox.** Not chosen: React Aria covers combobox, dialog and listbox under one documented accessibility model, tested across screen readers.
- **Plain CSS / CSS Modules.** Not chosen: no extra dependency, but more naming and file-hopping per component, and Tailwind is the more common skill.
- **Client-derived recent chips** (download recent Meals, compute the list). Rejected: transfers far more than six chips need, and the future MCP wrapper could not reuse it.
- **`DELETE /exercises/{id}/sessions/{day}` in one transaction.** Deferred: per-Set deletes are retry-safe; add the endpoint only if half-deleted Sessions show up in practice.

## Consequences

- Index work ([Indexes for v1 queries](https://github.com/bhh1893/health-tracker/issues/24)) must also serve "most recently used Catalog items per user" and `last_quantity`.
- The combobox needs a loading state and must drop out-of-order responses; keying each TanStack Query on `q` does this.
- Viewing a past Day and adding to it reuses the same windows; Day navigation is not designed yet.
- `prototype/form-ux` is never merged; `web` is rebuilt from this ADR with tests.
