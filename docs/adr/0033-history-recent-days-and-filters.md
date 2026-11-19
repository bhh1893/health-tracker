---
status: accepted
---

# History as Recent Days: a Meals filter and a required Exercise pick replace Search

History becomes one screen per kind that answers both "what happened?" and "how is it trending?". A Meals | Exercise toggle and a Range sit on top. Under them is the kind's search field, then a collapsed **Dashboard** section, then **Recent Days**: every Day in the Range with something logged, one collapsible row each. On Meals the field is an optional filter, matching Food and Restaurant names. On Exercise, picking an Exercise is required, and everything below it is about that Exercise. The Search screen goes away. Decided in [History revamp: Meals filter and required Exercise picker replace Search](https://github.com/bhh1893/health-tracker/issues/243), on the map [Health Tracker v1: bottom navigation and Profile](https://github.com/bhh1893/health-tracker/issues/222), from mockups H2, H2b, H3a and H3. It replaces ADR 0031's History layout and amends ADR 0006, ADR 0013 and ADR 0024.

## Shape

### One screen, one URL

- **Route:** `/history`. Everything the screen shows is in its query string, so Back, a reload and ADR 0031's per-tab memory all return to the same view:

  | Parameter | Meaning | Default |
  | --- | --- | --- |
  | `tab` | `meals` or `exercise` | `meals` |
  | `range` | `7d`, `30d`, `60d`, `90d`, `1y`, `all` (ADR 0024's ranges, plus `7d`) | `30d` |
  | `q` | Meals filter text | none |
  | `id`, `name` | the picked Exercise | none |
  | `dash` | `open` when the Dashboard section is open | closed |

- **Default tab flips to Meals.** Exercise now shows nothing until an Exercise is picked, so it is a poor landing. A `/history` URL from before this ADR that has `id` but no `tab` still opens Exercise, so a saved Exercise chart keeps working.
- **Which Days are open is not in the URL.** Opening a Day is a quick look, not a setting. Every Day starts closed (amended 2026-11-19: the newest Day used to start open, which pushed the rest of the list down on every visit).

### Layout, top to bottom

1. **Meals | Exercise** toggle, a full row. The **Range** sits beside the search field (amended below).
2. **The search field**, which differs by kind (below).
3. **Dashboard**, a collapsible section holding ADR 0024's tiles and chart. It starts closed, and `dash=open` keeps it open. The chart chunk loads the first time it opens, not when History opens, so a History visit no longer pays for the chart library.
4. **Recent Days**, the Days in the Range with something logged, newest first. The list loads more as it scrolls, never the whole Range at once. Each row is titled `MM-DD-YY [Weekday]`, e.g. `11-16-26 [Monday]`, and opens to show the Day's contents. This format is History's own; Add's Day pager keeps `formatDay`.

### Meals

- **The filter is optional.** Empty, Recent Days lists every Day with a Meal. With text, it keeps only the Days where some Food or Restaurant name contains it, ignoring case: `chicken` keeps a Day with "Chicken breast" and a Day at "BBQ Chicken Shack".
- **A kept Day shows all of its contents**, with the matching text highlighted, so the rest of that Day stays in view.
- **The filter never narrows the Dashboard.** The averages and chart stay "all eating in the Range".
- **A Day's contents:** each Food with its quantity, or, on a Restaurant Day, its Restaurants. A Restaurant Day's row shows an orange **Ate out** pill.
- **Chart:** a Restaurant Day is an orange point on the calories line itself, with no legend. The Ate out pills in Recent Days, in the same orange, explain it.

### Exercise

- **Picking an Exercise is required.** Until one is picked, the screen shows the picker, recent-Exercise chips (ADR 0008's order) and a one-line prompt. Nothing else shows.
- **Once one is picked**, the Dashboard (ADR 0024's tiles and charts) and Recent Days cover that Exercise only. Each Day lists its Sets.
- **Recent Days reads `GET /exercises/{id}/sessions?from&to`** (ADR 0024), which already returns one Session per Day with its Sets.

### Search goes away

- The Search screen and its "Everything" and "Last Sessions" views are removed. Range "All" on Exercise covers Last Sessions.
- **Redirects, kept forever (ADR 0031's contract).** `/history/search` and `/search` both go to `/history`, mapping what still has a meaning:

  | Old | New |
  | --- | --- |
  | `what=food`, `id`, `name` | `tab=meals&q=<name>` (the Food becomes a filter by its name) |
  | `what=exercise`, `id`, `name` | `tab=exercise&id&name` |
  | anything else | `tab=meals` |

  Search's ranges (Today, Yesterday, 7 days, Custom) have no match in History's, so they drop to the default.

### API (additive within `/api/v1`, ADR 0006)

- **New `GET /meal-days?from&to&q&cursor&limit`.** It returns a page of Days, newest first, each with all of its Meals in the shape `GET /meals/{id}` returns, plus `next_cursor`.
- **`q`** keeps the Days where some Food Entry's Food or some Restaurant Meal's Restaurant has a name containing `q`, ignoring case. The comparison is `lower(name) LIKE '%' || lower(q) || '%'`, with `%`, `_` and `\` in `q` escaped. It reads names through the existing `*_name_trgm` indexes, which are GIN indexes on `lower(name)` (ADR 0012), so no new index is needed. Its query plan joins the `index-plans` check like every other v1 query.
- **`cursor`** is the last Day of the previous page; the next page holds Days before it. A Day is never split across pages.
- **`limit`** counts Days: default 20, maximum 100.
- `GET /meals` and `GET /days` are unchanged.

## Considered Options

- **Keep Search and Dashboards as separate screens behind a link (ADR 0031's H2).** Rejected: Search's default "Everything" had no text field, so the box promised typing and led to chips. Two screens with two URLs also split one question, "what did I eat on chicken days and how is my calorie trend?", across a screen change.
- **`q` on `GET /meals`.** Rejected: it filters Meals, not Days, so a match would hide the rest of its Day. It also pages by Meal, so one Day could straddle two pages.
- **Filter in the browser.** Rejected: the Range can be "All", and Recent Days pages. A browser filter could only see the pages loaded so far, so it would miss older matches.
- **Fuzzy, typo-tolerant matching (`pg_trgm` similarity).** Rejected for now: a filter that silently matches "chiken" to "chicken" also matches near-misses you did not mean. Plain substring is predictable and still uses the same index.
- **Let the filter narrow the Dashboard.** Rejected: "average calories on chicken days" is a different question, and it would change the meaning of numbers people read at a glance.
- **Exercise Recent Days without a pick, listing every Exercise per Day.** Rejected by the owner: an Exercise's progress is the question, and a mixed list answers it badly.
- **One app-wide date format.** Rejected: the Day pager is narrow, and the new format was asked for Recent Days.

## Consequences

- History no longer loads the chart library by default, so its first paint is faster. Opening the Dashboard shows a short load the first time.
- `/history/search` links keep working but lose any range or custom dates they carried.
- `web` loses the Search screen and its query code. Recent Days on Meals pages by Day, and on Exercise it reads one Exercise's Sessions. Search's merging of two cursor streams goes with it.
- A filter like `a` matches most Days. That is correct, and paging keeps it cheap.
- Restaurant Days are visible in Recent Days only through the Ate out pill. A filter by Food name never matches a Restaurant Day unless the Restaurant's name matches too, because a Restaurant Meal has no Food Entries.

## Amendment: toggle row and a 7 day Range

Changed after phone use, 2026-11-18.

- **Layout:** Meals | Exercise is a full-width segmented toggle on its own row, styled like Add's Exercise | Meals switch. The Range moves down beside the search field: field three quarters, Range one quarter, both labelled.
- **Ranges:** `7d` is added before `30d`, for "what did I do this week". The default stays `30d`.
- **Recent Days has no visible title.** A heavier border sets the list apart instead. "Recent Days" stays the name in docs and code; screen readers hear the list as "Days".
