# PROTOTYPE: Query screens (throwaway, never merged)

Answers [Query screens](https://github.com/bhh1893/health-tracker/issues/32): how the user browses past Days, date ranges, filters by Food or Exercise, and sees the last N Sessions. Builds on the ADR 0008 feed look.

```sh
cd services/web/prototype-query-screens
npm install
npm run dev   # open http://<host LAN IP>:5173/?variant=A on the phone
```

Variants (switch with the pink bar or the arrow keys):

- **A** Day pager in the existing windows: ‹ date ›, one filter, tap an Exercise name for its last 5 Sessions. No range view.
- **B** History tab: newest-first list of Days that expand in place, 7/14/30-day range, Food/Exercise filter.
- **C** Ask screen: sentence-style query (what, name, range, or Last N Sessions), results grouped by Day.

Read-only, seeded with 30 days of history in `src/data.ts`. No tests, no error handling: rewrite, do not promote.
