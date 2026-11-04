---
status: accepted
---

# Query screens: a Day pager in the two windows, plus a separate search screen

Browsing the past has two jobs, and v1 gives each its own surface. The two logging windows of ADR 0008 (Exercise, Meals) gain a **Day pager** for "I'm on a Day" (look, add a forgotten Set, fix an Entry). A separate **Search screen** answers "I'm asking a question" (a range, one Food or Exercise, progress over time). Chosen from three clickable variants on a phone ([Query screens](https://github.com/bhh1893/health-tracker/issues/32), branch `prototype/query-screens`, variants A and C; B, a History tab, was dropped as a subset of C once C's Days collapsed). No API change: everything is served by ADR 0006 as written.

## Day pager (in the Exercise and Meals windows)

- **Header:** `‹ Day ›`. ‹ steps back one Day, › steps forward and is disabled on Today. Tapping the date opens the phone's native date picker (`max` = today; no future Days). A banner, "Viewing a past Day, tap to jump to Today", shows whenever the viewed Day is not Today.
- **The viewed Day is URL state** (`/exercise?day=2026-11-02`, `/meals?day=...`; absent means Today). This is what lets the Search screen deep-link into a Day, and a reload or back button keep your place.
- **Adding to a past Day** uses the existing sheets: the button reads "Add Set to Mon Nov 2", the time input is time-only on the viewed Day (ADR 0008), and the one-tap repeat Set copies the previous Set's weight and reps but takes its Occurred At from the viewed Day, not from now.
- **Filter:** one search box per window, the same fuzzy `ComboBox` as the add forms, narrowing the Day's feed to one Exercise or one Food.
- **History from a Session:** tapping an Exercise's name on a Session card opens a bottom sheet with its last 5 Sessions (`GET /exercises/{id}/sessions?limit=5`).
- **Entry point to Search:** a search icon in the header of both windows.

## Search screen

- **Query shape:** choose what (Exercise, Food, or Everything), then for Exercise or Food a **fuzzy-search box** (React Aria `ComboBox`, `GET /{kind}s?q=` with the same ~150 ms debounce as ADR 0008), then a range: Today, Yesterday, 7 days, 30 days, or custom from/to.
- **Search never creates.** Unlike the add forms there is no `+ Create "<text>"` row. Text that matches nothing shows "No match" and no results. Results appear only after a suggestion is picked; editing the text clears the pick, so half-typed text never shows wrong results. The pick supplies the `food_id` or `exercise_id`.
- **Results are collapsed Day rows**, newest first: the Day, plus a one-line summary ("4 sets, top 140 lb × 5" for an Exercise query; "2 exercises, 9 sets, 3 meals" for Everything; meal counts for Food). Tapping a row expands its Sessions and Meals in place. A scan of a month stays one screen long.
- **Last N Sessions:** once an Exercise is picked, a mode replaces the range with a stepper (default 5) and shows a progression table per Session: Day, Sets, top Set, volume (`GET /exercises/{id}/sessions?limit=N`).
- **Jump to Day:** an expanded Day row has an "Open this Day" link to the Day pager at that Day.
- Range queries fetch `GET /meals` and `GET /exercise-entries` with `from`/`to` and the Catalog id, following the keyset cursor to the end (a month is far below the 200-item page cap per page, so normally one request each). The client merges the two collections by Day and groups Sets into Sessions.

## Considered Options

- **Variant B, a third bottom tab "History"** (a newest-first list of Day rows with a range control and a filter). Not chosen: its one distinct idea, the collapsed Day row with a summary, moved into the Search screen, and its 7/14/30-day ranges are a subset of the Search screen's. What remained was a navigation difference, not a capability, and it would crowd the daily logging screen.
- **Search as a third window next to Exercise and Meals.** Not chosen: logging is the daily action; a header icon keeps it two taps from anywhere without making the logging screen busier.
- **A single search box over Foods and Exercises together.** Not chosen for v1: the two Catalogs are separate lists, so each suggestion would need a type tag. Revisit if the Exercise/Food/Everything chips feel clumsy.
- **Plain dropdowns of all Foods or Exercises for the filter** (what the prototype first used). Rejected: the lists grow without bound, and the add forms already taught the fuzzy `ComboBox`.
- **Live results while typing** (instead of requiring a picked suggestion). Not chosen: partial text such as "ch" matches many items and flashes misleading results. Easy to add later without any API change.

## Consequences

- No API or index change. The Search screen's heaviest query is a 30-day range, which ADR 0012's feed indexes already serve.
- Per-Day summaries (set counts, top Set, volume) are computed in the client from the fetched Entries, not by the API. If ranges later grow to years, a server-side `GET /days?from=&to=` summary endpoint would be the additive fix, and would also suit the future MCP wrapper.
- Both windows and the Search screen must read the Day from the URL; the client router (ADR 0007) owns it, not component state.
- `prototype/query-screens` is never merged; `web` is rebuilt from this ADR with tests. The prototype's 30-day seed (`src/data.ts`) is a reasonable template for the index seed in ADR 0012.
