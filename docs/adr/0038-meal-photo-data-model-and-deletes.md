---
status: accepted
---

# Meal Photos are a sub-resource of their Meal, written bytes-first and swept for orphans

A Meal Photo is a row in `meal_photos` plus an object in the `meal-photos` bucket (ADR 0036). Photos have their own endpoints under their Meal, and `PUT /meals/{id}` never touches them. Postgres and Garage cannot share a transaction, so every write is ordered so a failure leaves only an **orphan** (bytes with no row), never a **dangling row** (a row with no bytes), and a scheduled sweep deletes orphans. Decided in [Meal Photo data model, API and deletes](https://github.com/bhh1893/health-tracker/issues/299), on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Builds on ADR 0036 and ADR 0037.

## Shape

- **URLs:** `PUT`, `GET` and `DELETE /api/v1/meals/{meal_id}/photos/{photo_id}`. The photo ID is a client-minted UUIDv7, as Meal IDs are. The `PUT` body is the raw image (ADR 0037).
- **Table:** `meal_photos (id, user_id, meal_id, upload_sha256, created_at, ...)`, with `FOREIGN KEY (meal_id, user_id) REFERENCES meals (id, user_id) ON DELETE CASCADE` as in `meal_restaurants` (ADR 0034). There is no `meal_kind` column because both kinds hold photos. Whatever metadata [Processing a Meal Photo](https://github.com/bhh1893/health-tracker/issues/298) settles on (for example width and height) goes in this row too.
- **Garage key** is derived, `{user_id}/{photo_id}`, and not stored, so it cannot drift from the row.
- **Order** is by photo ID. UUIDv7 sorts by time and the client mints IDs in the order photos were picked, so no position column is needed. **Replace** is remove plus add, so the new photo goes last. There is no reordering in v1.
- **Separate from `PUT /meals`.** That endpoint replaces a Meal whole. If photos rode in its body, a client from before this change (ADR 0006) would send none and wipe them. Uploading to a Meal that does not exist, or is not yours, is `404`.
- **The sheet is a draft until Save.** Photos added or removed in the Meal sheet are held on the phone. Save sends `PUT /meals` first, then uploads the added photos and deletes the removed ones. Cancel changes nothing, for new and saved Meals alike. [Meal Photos in the Meals window](https://github.com/bhh1893/health-tracker/issues/302) settles where progress and ✕/retry show after the sheet closes.
- **Upload, bytes first:**
  1. Pre-check that the Meal is yours and holds fewer than 10 photos, so no bytes are stored for a request that will fail.
  2. Put the object in Garage.
  3. In one transaction: `SELECT ... FROM meals ... FOR UPDATE` (`404` if gone), count again, insert the row, commit.
  4. If step 3 fails, delete the object best-effort.

  The row lock in step 3 holds the cap when two uploads race at 9 photos, and it decides a Meal deleted mid-upload: the upload gets `404` and its bytes become an orphan.
- **Status codes for `PUT`:**
  - `201` created.
  - `200` a repeat with the same ID and the same bytes (by `upload_sha256` of the bytes as uploaded, before any re-encoding). It returns the stored photo.
  - `409 photo-id-taken` the ID exists with different bytes, or under another of your Meals.
  - `409 meal-photo-limit` the Meal already holds 10.
  - `404` the Meal, or the photo ID, belongs to someone else.
  - `413` over the per-photo cap.
  - `503` Garage is unreachable.
- **`GET`** answers `404` for a photo that is missing or not yours, by the same rule.
- **Deletes, row first:** `DELETE` on a photo, or on a Meal (its rows go by cascade), commits the row delete first, then deletes the objects best-effort. `DELETE` on a photo is always `204`, as for Meals.
- **Reconciliation sweep:** an hourly Kubernetes CronJob on the `api` image lists the bucket, compares it with `meal_photos`, and deletes objects with no row that are older than 1 hour. The hour keeps it clear of uploads whose row is not committed yet. This one job heals failed byte deletes, failed uploads, and the deletes of an `api` pod from before this change during a rollout, which cascade the rows but leave the bytes.
- **Read shape:** every Meal response (`GET /meals`, `GET /meals/{id}`, the `PUT /meals` response) gains an additive `photos: [{id, url}]` in order. `url` is the relative photo path, handed out by the server so a later move to presigned URLs (ADR 0037) changes no client.

## Considered Options

- **Photo IDs in the `PUT /meals` body.** A new Meal and its photos would save in one call. Rejected: under "replace whole", an older client's PUT drops every photo, and "omitted means keep" would make one endpoint mean two things.
- **Apply photo changes immediately in the sheet.** Uploads would start sooner. Rejected: Cancel would no longer mean nothing changed, and a new Meal would need server-side "staged" photos with no Meal to own them.
- **Row first, marked pending, then bytes, then mark ready.** Rejected: a third state that every read must filter, and a failed upload still leaves something to clean.
- **Position column.** It would let replace keep its slot and allow reordering. Rejected for v1: it needs a reorder API and renumbering under the lock for a feature nobody asked for.
- **Transactional outbox for deletes.** A `photo_deletions` row is written in the delete's transaction and drained by a worker, which guarantees deletes without listing the bucket. Rejected: it cannot see upload orphans, so a sweep would still be needed. One mechanism beats two at this size.
- **Flat `/api/v1/meal-photos/{id}`.** Rejected: the upload would need its Meal ID in a header or query, and the nested path says who owns the photo.

## Consequences

- A deleted photo can stay in Garage until the next sweep, up to about two hours. Copies in backups are for [Backing up and restoring Meal Photos](https://github.com/bhh1893/health-tracker/issues/301).
- The sweep lists the whole bucket each run. That is cheap at ten photos per Meal and a handful of Users, and is the first thing to revisit at scale (a per-user prefix listing or an outbox).
- A Meal's `updated_at` does not change when its photos do.
- The sweep needs `api`'s Garage key to list and delete, which it already has on `meal-photos` only (ADR 0036). Whether its failures are visible belongs to the map's observability fog.
