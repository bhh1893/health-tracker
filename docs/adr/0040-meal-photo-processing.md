---
status: accepted
---

# The browser shrinks each Meal Photo to a JPEG, `api` re-encodes it clean, and the original is kept unopened

Each Meal Photo is stored as three objects: the **original** exactly as the picker handed it over, a **full view** and a **thumbnail**. The phone uploads two of them, the original and a JPEG it made itself. `api` never trusts that JPEG: it decodes it under strict limits and re-encodes both views from its pixels, carrying no metadata over. `api` never opens the original. It stores it as an archive copy and never serves it. Decided in [Processing a Meal Photo: resize, re-encode, strip metadata](https://github.com/bhh1893/health-tracker/issues/298), on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Builds on ADR 0036, 0037, 0038 and 0039. Facts behind it: [phone photos in the browser research](https://github.com/bhh1893/health-tracker/blob/research/phone-photos-in-browser/docs/research/phone-photos-in-browser.md).

## Context

- `api` has a 256Mi memory limit (ADR 0037). Decoded at 4 bytes per pixel, a 24 MP iPhone photo is about 98 MB and a 48 MP one about 195 MB. Two at once would get the pod OOM-killed.
- Image decoders are memory-unsafe C, and they have a long CVE history. Pillow 13.0.0 fixed a heap overflow on its JPEG resize path (CVE-2026-112403). HEIC needs libheif (about 30 CVEs in 2026) and libde265 (68). Every approved User can upload, so the decoder takes input from anyone with an account.
- The owner keeps no phone backup (iCloud Photos is off), so the phone's library is the only copy of a picked photo. Camera shots taken through the page are never saved to Photos at all.

## Shape

- **Original:** the file exactly as picked, HEIC or JPEG. It is write-only from the app's point of view:
  - `api` checks the byte cap and the file signature (the first bytes) against an allowlist of HEIC/HEIF and JPEG.
  - `api` never decodes it and has no route that serves it.
  - Getting one back is an operator action from Garage or the host copy (ADR 0039).
  - Any EXIF inside it survives, including GPS if the User turned location on in the picker. That is acceptable because no route serves it.
- **Full view:** JPEG, 2048 px on the long edge, quality 85. **Thumbnail:** JPEG, 512 px on the long edge. [Meal Photos in the Meals window](https://github.com/bhh1893/health-tracker/issues/302) may tune the thumbnail size. Both come from the same decoded pixels, so a thumbnail never differs from its full view.
- **All or nothing:** a photo exists, and shows as saved, only when all three objects are stored.
- **Browser:**
  - The picker uses `accept="image/*"`, so iOS hands over the stored HEIC and not a transcoded JPEG.
  - Photos are processed one at a time, so a 48 MP decode never stacks up and gets the tab killed.
  - Each one is decoded with `createImageBitmap` (orientation applied, so the pixels come out upright), drawn onto an sRGB canvas at ≤ 2048 px, and encoded as JPEG at quality 0.92. The server's q85 pass is the only noticeable loss.
  - A file the browser cannot decode, for example a HEIC in Chrome, is refused with "This photo can't be read here". No original is stored without a view.
- **`api` re-checks the JPEG:** `Image.open(formats=["JPEG"])`, so no other decoder can run. Single frame only, so MPO is refused. The header must say ≤ 2048 px on the long edge, checked before decoding, which stops a decompression bomb. A full `load()` must succeed. Anything else gets `422`.
- **`api` never reads EXIF.** The browser's canvas JPEG carries none, and its pixels are already upright, so `exif_transpose()` and the EXIF parser never run (CVE-2026-128066 lives there). An upload crafted with an orientation tag just shows sideways for the User who crafted it.
- **Nothing carried over:** `save(quality=85)` with no `exif`, no `icc_profile` and `comment=""` set explicitly, because Pillow forwards the source's JPEG comment by default. Colour is sRGB only. A unit test feeds in a JPEG carrying GPS EXIF and a comment, and asserts the output has no APP1 (EXIF/XMP) or COM (comment) marker.
- **Where it runs:** in the `api` process, in a worker thread so the event loop keeps serving. Isolating the decode in its own process or service is for [Meal Photo limits, quotas and threat model](https://github.com/bhh1893/health-tracker/issues/300).
- **Pillow stays current.** Its CVE fixes ship in its own releases and in the libraries its wheels bundle (libjpeg-turbo), so a Pillow bump is a security update.

## Amends ADR 0037 and 0038

- **Two uploads per photo, still one object per request:**
  1. `PUT /api/v1/meals/{meal_id}/photos/{photo_id}/original`, with the body sent as picked and `Content-Type: image/heic` or `image/jpeg`.
  2. `PUT /api/v1/meals/{meal_id}/photos/{photo_id}`, with the browser's JPEG.

  Each request has its own byte cap, and the limits ticket sets both.
- **Bytes first still holds:**
  1. Step 1 puts the original. It writes no row.
  2. Step 2 checks that the original exists in Garage (`409 photo-original-missing` if not, and the client sends it again), decodes and re-encodes, and puts the full view and thumbnail.
  3. Step 2 then inserts the row under ADR 0038's lock.

  Abandoning at any point leaves only orphans, never a dangling row.
- **Keys:** `{user_id}/{photo_id}/original`, `/full`, `/thumb`. They are still derived and never stored. The sweep treats every object under a photo ID with no row as an orphan.
- **Row:** `upload_sha256` is the browser JPEG's hash, as ADR 0038 says. The row gains `original_sha256`, `original_type`, `width` and `height` (of the full view). A repeat of step 1 overwrites the original while no row exists. Once the row exists, a repeat answers `200` for the same hash and `409 photo-id-taken` for a different one.
- **Reads:** `GET .../photos/{photo_id}` serves the full view, and `GET .../photos/{photo_id}/thumb` serves the thumbnail, with the same `404` and `Cache-Control` rules (ADR 0037). Each Meal's additive `photos` entries gain `thumb_url`. Nothing serves the original.
- **Restore (ADR 0039):** a row counts as dangling if any of its three objects is missing everywhere. The 100-object sweep brake now trips at about 33 photos.

## Considered Options

- **Server-only resize:** the phone sends the original and `api` makes the views. The client stays simpler and every browser behaves the same. Rejected: full-size decodes inside 256Mi, plus HEIC decoders (libheif, libde265) that need patching about monthly, all on input from anyone with an account.
- **Browser-only:** `api` stores what arrives. Rejected: a crafted file or GPS would go straight into storage.
- **No original, an archive-grade 4032 px full view instead.** One upload per photo. It would suit an owner whose library is already in iCloud. Rejected because the phone's library is the only copy here.
- **Two objects: the browser scales the full view down on the Meal card.** Rejected: about 4 MB on first view of a full Meal against about 0.4 MB, and about 12 MB of decoded memory per photo on the phone. That risks the tab being killed in the Meals window.
- **Show the photo once its views land, and upload the original in the background.** Faster to show. Rejected: a photo could look saved while its archive copy never arrived, and ✕/retry would have to cover a half-done state.
- **Restricted `accept` (`image/jpeg`):** iOS transcodes first, so every browser can read the file. Rejected: the original would no longer be the original, and iOS shows a silent delay while it converts.
- **WebP or HEIC as the stored view.** Rejected: Safari cannot encode WebP from a canvas (it silently returns PNG), and Chrome cannot show HEIC.
- **Keep the ICC profile and a Display P3 canvas.** Rejected: re-saving with an ICC profile was a Pillow heap overflow (CVE-2026-96778). The shift to sRGB is slight, and the original keeps P3.
- **A separate decode process or service.** A decoder exploit would land outside `api`. Deferred to the threat-model ticket. JPEG-only input, ≤ 2048 px and a current Pillow are the v1 guard.

## Consequences

- Storage is about 10x the views alone: a HEIC original runs about 3-5 MB against about 0.5 MB for the views. The Garage quota, the per-request caps and the host copy's disk (ADR 0039) are for the limits ticket.
- The host copy (ADR 0039) now also holds every User's originals, with any GPS in them, unencrypted on the owner's PC. It is an input to the threat model.
- The archive is only as good as the host copy. It survives losing the dev VM, not losing the PC.
- Uploading a 10-photo Meal on cellular sends roughly 40 MB more than the views alone would.
- **Verify at build:**
  - On the owner's iPhone, does `accept="image/*"` return HEIC?
  - Does a photo rotated in the Photos app come out upright?
  - What are decode time and peak memory for 10 photos at 12, 24 and 48 MP, one at a time?
  - What is the `api` memory peak with two uploads at once?
