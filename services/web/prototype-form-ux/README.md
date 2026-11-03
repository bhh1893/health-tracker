# PROTOTYPE: Form UX (throwaway, never merged)

Answers [Form UX prototype](https://github.com/bhh1893/health-tracker/issues/14): what logging a Set, a Meal with Food Entries, and a Restaurant Meal should feel like on a phone. Decision recorded in ADR 0008 on `main`.

```sh
cd services/web/prototype-form-ux
npm install
npm run dev   # open http://<host LAN IP>:5173/?variant=D on the phone
```

Variants (switch with the pink bar or the arrow keys):

- **A** One form: segmented Set / Meal / Restaurant tabs.
- **B** Step by step: one decision per screen, steppers.
- **C** Day feed + bottom sheet.
- **D** C + two windows (Exercise, Meals). **Chosen.**

Everything is in memory (`src/stub.ts` stands in for the API in ADR 0006). No tests, no error handling: rewrite, do not promote.
