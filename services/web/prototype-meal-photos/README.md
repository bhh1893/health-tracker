# PROTOTYPE: Meal Photos in the Meals window (throwaway, never merged)

Answers [Meal Photos in the Meals window](https://github.com/bhh1893/health-tracker/issues/302): how Meal Photos look and behave on the Meal card and in the Meal sheet, where upload progress and Retry / Discard show once the sheet closes, and what happens at the cap of 10. The rules come from ADR 0038: the sheet is a draft until Save, Save sends `PUT /meals` then the uploads and deletes, Cancel changes nothing, a new photo goes last.

```sh
cd services/web
npm run prototype:photos   # open http://<PC's Wi-Fi IP>:5173/?variant=A on the phone
```

It reuses the real color tokens, `Sheet`, `MealContents` and `PencilIcon` from `src/`, so the photo parts sit in the real Meals window's density. Food and Restaurant editing is left out.

Variants (switch with the purple bar or the arrow keys; ⚙ makes uploads flaky or failing and the network slow):

- **A Thumbnail strip. Chosen.** Square thumbnails in a sideways row under the contents. Progress ring and red ↻ on each thumbnail; tap a failed one for Retry / Discard. Sheet: same strip, Add tile first, ✕ on each.
- **B Cover + status line.** First photo as a banner with a count badge. One "Uploading 2 photos" line with a bar, one red line with Retry / Discard. Sheet: separate Camera and Library buttons, 3-column grid with Remove.
- **C Chip + upload tray.** Card unchanged plus a 📷 count chip that opens a grid. One tray above the Add buttons for all uploads on the Day, expands to a per-photo list. Sheet: grid with Add tile last; remove from the full-screen viewer.

Seeded: Breakfast (no photos), Lunch (3), Dinner (10, at the cap). Everything is in memory (`src/store.ts` stands in for the API); reload starts over, which is also what happens to a real upload queue when the tab dies. No tests, no error handling: rewrite, do not promote.

## Verdict

**A**, decided 2026-11-28 and recorded in ADR 0040 on `main`. Two changes from what is built here: after a pick, the sheet's strip scrolls to show the new photos at its end (the Add tile stays first), and an upload lost when the tab dies is accepted for v1 as a known limitation.
