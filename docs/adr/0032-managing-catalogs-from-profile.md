---
status: accepted
---

# Managing Catalogs from Profile: one page per Catalog, and Nutrition edited only there

Logging a Meal and fixing a Food become two separate jobs done in two places. Add logs: a new Food is created from the combobox with no Nutrition, as before. Profile manages: a **Catalogs** section links to one page each for Foods, Restaurants and Exercises, where the User searches, creates, renames, archives and (for Foods) fills in Nutrition. The Food sheet moves from the Meal sheet to Profile, and the Restaurant Day calories setting moves from the History dashboard to Profile's Settings. Decided in [Managing Foods, Restaurants and Exercises from Profile](https://github.com/bhh1893/health-tracker/issues/221), on the map [Health Tracker v1: bottom navigation and Profile](https://github.com/bhh1893/health-tracker/issues/222). It amends ADR 0006, ADR 0023 and ADR 0024.

## Shape

### Pages

- **Routes:** `/profile/foods`, `/profile/restaurants`, `/profile/exercises`, inside ADR 0031's Profile tab. Profile's menu heads the section **Catalogs**, the glossary's word, not "Your lists"; the page titles are Foods, Restaurants and Exercises.
- **The whole Catalog, loaded once.** Each page asks the existing list operation (`GET /foods`, `/restaurants`, `/exercises`) with no `q` and `limit=1000`, in its existing order: most recently used first, then never-used items by name. If exactly 1000 come back, the page says "Showing the first 1000", so the cap is never silent.
- **Filtering in the browser:** a search box ("name contains", case-insensitive), a "No nutrition yet" chip on Foods, and a "Show archived" toggle (the page then asks with `include_archived=true`). All three live in the URL (`?q=`, `?missing=1`, `?archived=1`), so Back and ADR 0031's per-tab memory bring the list back as it was. Whether a sheet is open is not in the URL.
- **Rows:** the name; for a Food, its calories per Basis and macros, or a "No nutrition yet" tag; an Archived tag when archived items are shown.

### Sheets

- **Foods** open the existing Food sheet (ADR 0023): name, Fill from reference, Nutrition, Piece Weight.
- **Restaurants and Exercises** share one Catalog item sheet: the name and nothing else to edit.
- **Archive, Unarchive, Delete.** Every sheet offers Archive, or Unarchive for an archived item. Delete appears only for an item never used, which the client reads from the item's `last_used_day` (null when no Entry uses it); the API still refuses to delete a used item (`409`).
- **"+" creates** through an empty sheet. Save sends one `PUT` with a client-made id, the same create path logging uses, so a Food can be set up from its label before it is first eaten.
- **Name clashes**, on create and on rename, reuse the logging combobox's flow: an exact match blocks the save and links to the existing item; a close match lists the similar names with "Save anyway", which resends with `allow_similar`.

### What leaves the other screens

- **Meal sheet:** a Food Entry's name no longer opens the Food sheet. Nothing about Nutrition is edited from Add.
- **Day total:** the Incomplete badge links to `/profile/foods?missing=1`. This replaces ADR 0023's "tapping it lists the Day's Foods, each opening its Food sheet", which was never built.
- **History dashboard:** the Restaurant Day calories field moves to Profile's Settings, still saving through `PATCH /api/me`. Saving refreshes the cached `GET /days` data, so History redraws on its next visit.

### API (additive within `/api/v1`, ADR 0006)

- The maximum `limit` on `GET /foods`, `/restaurants` and `/exercises` rises from 50 to 1000. The default (10) and the typeahead's own `limit` are unchanged.
- Every item those three Catalogs return from their own endpoints gains `last_used_day`: the Day of the newest Entry that uses it, or null. Found while building [Catalog pages on Profile](https://github.com/bhh1893/health-tracker/issues/233): only a Food said whether it was used (`last_quantity`), so Exercises and Restaurants could not hide Delete. The server already computed the Day to sort recents. Entries keep embedding the plain `CatalogRef` (`id`, `name`, `archived`).

## Considered Options

- **Keep the Food sheet in the Meal sheet too.** Rejected by the owner: logging should stay fast and never stop for a label. A Meal is saved complete with a Food that has no Nutrition, and the Incomplete badge points to where it is finished.
- **A deep link from a Food Entry straight to its sheet in Profile.** Rejected: the badge's link to the filtered list covers it, with no sheet state in the URL.
- **A capped list of 50 with server search, or real cursor pagination.** Rejected: a User's Catalogs are small, and a full list makes browsing and filtering instant. Pagination would add a cursor to three endpoints for lists that fit in one response.
- **No cap at all.** Rejected: sign-up is open (ADR 0026), so any Google account can build a Catalog, and every response the server sends should have a bound.
- **A `missing_nutrition` filter on the server.** Not needed once the whole list is in the browser.
- **Merging two duplicate items.** Out of scope: it rewrites Entries across Meals and Sessions and needs its own design.

## Consequences

- Until a Food is finished in Profile, every Day it is logged on is Incomplete. That is the intended nudge: the badge is one tap from the fix.
- Browser filtering is a plain substring match, not the server's fuzzy ranking, so "chiken" finds nothing on a list page while the logging combobox would find Chicken.
- A list page downloads every item of its Catalog on each visit. At a few hundred items that is tens of kilobytes; if a Catalog ever nears the cap, the notice says so and pagination becomes the fix.
- Restaurant Day calories can no longer be changed while looking at the chart.

## Amendment: sheet layout

Changed 2026-11-19 to make the Food sheet easier to scan.

- **Archive, Unarchive and Delete are icons in the sheet's header**, beside the title, on every Profile sheet. Delete still asks once more, on a line under the header. The "Archived items are hidden when logging" note is dropped: Archive is undone with one tap.
- **The Food sheet is two columns:** Name | Fill from reference, then Basis | Piece Weight, Calories | Protein, Carbs | Fat, then Cancel | Save. Clear sits on the Nutrition header and still leaves Piece Weight alone.

## Amendment: Add button at the bottom, no Back link

Changed 2026-11-19. Each Catalog page drops its Back link: tapping Profile in the bar already returns there. The header "+" becomes an **Add Food / Add Restaurant / Add Exercise** button pinned just above the bar, the same place and style as Home's Add Meal, so creating something is in thumb reach on every screen. It opens the same empty sheet as before.
