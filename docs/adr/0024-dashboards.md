---
status: proposed
---

# Dashboards: a third header screen with an Exercise tab and a Meals tab, drawn with Recharts

Search answers "what happened?"; Dashboards answers "how is it trending?". It is a separate screen at `/dashboards`, opened from a chart icon beside the Search icon, split into Exercise and Meals like the logging windows. Each tab charts one thing over a chosen range: an Exercise's top Set and volume per Session, or calories per Day. This settles the three questions [web: Dashboards screen](https://github.com/bhh1893/health-tracker/issues/129) left open (chart library, where aggregation runs, which metrics). It amends ADR 0006, ADR 0013 and ADR 0023.

Proposed, not accepted: it was written during the build, with the owner away, and is up for review with the code.

## Shape

### The screen

- **Entry point:** a chart icon in the window header, left of the Search magnifier. Back returns to the window and Day it came from, the same way Search does (router state).
- **Two tabs,** Exercise and Meals, and one **range**: 30 days, 60 days, 90 days, 1 year, All. A range ends today and includes it. The range is shared, so switching tabs keeps it.
- **Everything is URL state** (`/dashboards?tab=meals&range=90d`, `/dashboards?range=1y&id=...&name=Bench+Press`), like Search. Defaults are left out, so the plain screen is `/dashboards`.
- **Loaded on first visit.** The screen is its own bundle chunk (`React.lazy`), because the chart library is bigger than everything else `web` ships and the logging screens never use it.

### Exercise tab

- Pick an Exercise with the read-only `CatalogComboBox` from Search (no create row, archived items included).
- **Metrics:** top Set weight per Session and volume per Session, as two charts. "Top Set" and "volume" are Search's definitions (ADR 0013), imported, not rewritten.
- An Exercise never done with weight is charted by top Set reps and has no volume chart. Once any Session has weight, weight is the measure, and bodyweight Sessions are left off that one chart.
- Three headline numbers above the charts: Sessions, best top Set, and the change from the first Session in the range to the last.
- **Aggregation runs in the client,** from `GET /exercises/{id}/sessions`. The endpoint gains optional `from` and `to` (inclusive Days). It still returns at most 200 Sessions, so the client reads further back by asking again with `to` set to the Day before the oldest Session it has.

### Meals tab

- **Calories per Day,** from `GET /days` (ADR 0023). Aggregation runs on the server.
- **A Restaurant Day is drawn off the line:** an orange diamond at the User's flat value. The line joins the ordinary Days and passes under it, so a Restaurant Day reads as breaking the trend, not as a measurement.
- **An Incomplete Day is a ring** instead of a filled dot, because its total under-reports.
- Three headline numbers: average calories over the logged Days (Restaurant Days counted at the flat value), the number of Restaurant Days, the number of Incomplete Days.
- **Restaurant Day calories** are edited here, with one field that saves through `PATCH /api/me`. Saving redraws the chart, since every past Restaurant Day changes with it.
- **"All" walks back a window at a time.** `GET /days` takes at most 366 Days. After each window the client asks `GET /meals?to=<day before>&limit=1` for the newest older Meal, and starts the next window there. That ends the walk and skips gaps, so a year with no Meals does not hide the Days before it.

### Charts

- **Library: Recharts,** pinned like every other dependency.
- **Line charts on a calendar x axis:** a Day with nothing logged is a gap in the line's spacing, not a missing column.
- **Y axis:** calories start at zero, because they are read by their size. Top Set and volume do not, because they are read by their change and a zero baseline flattens it. Tick values are rounded (150, 160, 170).
- **Never color alone.** Each kind of mark has its own shape, a legend names them, and every chart has a "as a table" disclosure with the same values. The two colors come from a palette checked for colorblind-safe separation and contrast on white.
- Above about 45 points the dots are dropped and the line carries the data. Rings and diamonds stay, smaller.
- Tapping or hovering shows the Day's value, with the Sets or the macros.

### API (additive within `/api/v1`, ADR 0006)

- `GET /exercises/{id}/sessions` gains `from` and `to`.
- A foods Meal gains `total: {kcal, protein_g, carbs_g, fat_g, incomplete}` on every read. ADR 0023 left per-Meal totals out of its first cut and called them additive; Search now shows them. The Meal total and the Day Total share one SQL expression for an Entry's share, so a Day's Meals add up to its Day Total. A Restaurant Meal has no `total`: its Day counts as the flat value, and no part of that belongs to one Meal.

## Considered Options

- **Hand-drawn SVG instead of a chart library.** No dependency and no extra bundle, and three simple charts are within reach. Rejected: scales, tick rounding, touch tooltips and resizing would all be ours to write, test and fix, and Recharts' docs teach more than our own code would. The bundle cost is paid only by people who open Dashboards, because the screen is lazy-loaded.
- **A server summary for Exercises too** (`GET /exercises/{id}/progress`), mirroring `GET /days`. Rejected: "top Set" and "volume" would then be defined twice, in SQL and in Search's client code. One Exercise's Sessions are small rows, a few hundred even over years, so the client can afford them. Revisit if another client (the MCP wrapper) needs the same numbers.
- **Raising the 366-Day cap on `GET /days`** so "All" is one request. Rejected: the cap is what bounds that response (ADR 0023), and "All" is rare. The walk costs two small requests per year of history.
- **Bars for calories.** Rejected: at a year there are more Days than pixels on a phone, and a line reads the same at 30 points and 365.
- **Restaurant Days on the line,** as spikes. Rejected in #128's chart requirement: a spike reads as a real measurement and drags the eye, and the line between ordinary Days is the trend the chart is for.
- **A range per tab.** Rejected: one more thing in the URL and in the user's head, for a difference nobody asked for.
- **Estimated 1RM, Sessions per week.** Left out: two metrics answer "am I progressing?". Either is a function over the same Sessions and can be added without an API change.

## Consequences

- `web` gains its first lazy-loaded route. A user on a bad connection sees "Loading..." on first opening Dashboards.
- Charts are not asserted pixel by pixel. Component tests read the table view, which holds the same points; how a chart looks was checked by eye at phone width.
- "All" for a daily Exercise over many years reads Sessions 200 at a time, in sequence. Fine for one person's history; a server summary is the fix if it ever is not.
- The average on the Meals tab includes Incomplete Days at what they report, so it under-reports until Foods have Nutrition. The Incomplete count beside it is the warning.
- Until the Food sheet ([#160](https://github.com/bhh1893/health-tracker/issues/160)) exists there is no screen to enter Nutrition, so most Days show as Incomplete.
