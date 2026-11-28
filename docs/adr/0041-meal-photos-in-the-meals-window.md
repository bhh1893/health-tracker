---
status: accepted
---

# Meal Photos show as a thumbnail strip on the Meal card, and each thumbnail carries its own upload state

On the Meal card in the Home tab's Meals window, a Meal's photos are a row of small square thumbnails. Upload progress and failures show on the thumbnail they belong to, not in a separate tray or status line. The Meal sheet edits the same strip. Decided in [Meal Photos in the Meals window](https://github.com/bhh1893/health-tracker/issues/302) by trying three variants on a phone ([prototype branch](https://github.com/bhh1893/health-tracker/tree/prototype/meal-photos/services/web/prototype-meal-photos)), on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Builds on ADR 0008 (Day feed and sheets), 0038 (the sheet is a draft until Save) and 0040 (processing).

## Shape

- **Card:** under the Foods or Restaurants, a row of 64 px square thumbnails (cropped to fill), in photo order, scrolling sideways when it overflows. A Meal with no photos shows no row. The thumbnail image is ADR 0040's 512 px thumbnail, which leaves room for a bigger tile later.
- **Viewer:** tapping a saved thumbnail opens it full screen. Swipe sideways to page through the Meal's saved photos, a "2 / 5" counter, and ✕ to close. The viewer only shows photos. Removing one happens in the sheet, so a tap on the card can never delete anything.
- **Sheet:** a "Photos 3 / 10" label over the same strip. An Add tile comes first, then the photos, each saved one with a ✕ that removes it from the draft. Add opens the system picker with `accept="image/*"` and `multiple`, so iOS offers Photo Library and Take Photo from one button. After a pick the strip scrolls to its end, where the new photos land (ADR 0038). Photos still uploading from an earlier Save show dimmed and cannot be removed until they settle.
- **Unreadable photos are refused at pick.** A file the browser cannot decode (ADR 0040, for example a HEIC in Chrome) gets "This photo can't be read here" in the sheet. It never joins the draft, so it never fails later on the card.
- **Cap:** at 10 the Add tile goes and the sheet says "A Meal holds at most 10 photos. Remove one to add another.", worded like the Restaurant cap (ADR 0034). Picking more than there is room for keeps the first ones in pick order and says "Added 2 of 5."
- **After Save:** the sheet closes as soon as `PUT /meals` succeeds, and the uploads carry on from the card:
  - **Queued:** dimmed, with an empty ring.
  - **Uploading:** dimmed, with the ring filling. One ring covers the browser's shrink and both requests of ADR 0040.
  - **Failed:** dimmed, with a red outline and ↻. Tapping it offers **Retry**, which resends the same photo ID so a request that reached the server is a harmless repeat (ADR 0038), and **Discard**, which drops a photo that was never saved.
  - **Removed photos** leave the card at once. If the `DELETE` fails, the photo comes back with ↻ and only Retry.
- **One upload at a time** across all Meals, oldest first, as ADR 0040 processes one photo at a time.

## Considered Options

- **Cover photo plus a status line:** the first photo as a banner across the card, with one "Uploading 2 photos" line and one Retry / Discard line per card. Rejected: a banner on every Meal with photos makes the Day feed much longer, and one line for many photos cannot say which photo failed.
- **Count chip plus an upload tray:** the card gains only a "📷 3" chip, and one tray above the Add buttons lists every upload on the Day. Rejected: the card's photos are hidden behind a tap, and the tray is a second place to look that floats over the feed.
- **Separate Camera and Library buttons:** `capture` opens the camera in one tap. Rejected: iOS's own menu already offers both from one button, and two buttons take a row in a sheet that is short on height.
- **Add tile last,** where new photos land. Rejected: on a Meal with eight photos you would scroll to reach it. Keeping it first and scrolling to the new photos after a pick gives both.

## Consequences

- **Uploads live in the open tab.** If the phone kills the tab or the app is closed mid-upload, the pending photos are lost. Their bytes become orphans for the sweep (ADR 0038), and the Meal simply lacks them next time. Accepted for v1. Keeping the queue in IndexedDB and resuming it is the fix if it bites.
- **A failure shows only on its own Meal's card.** Paging to another Day hides it until you come back. There is no app-wide "something failed" signal in v1.
- **The card grows by one row** (about 72 px) for any Meal with photos, whatever the count.
