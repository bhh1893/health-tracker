# Research: phone photos in the browser - HEIC, re-encoding and EXIF

Facts for [Phone photos in the browser: HEIC, re-encoding and EXIF](https://github.com/bhh1893/health-tracker/issues/294), on the map [Health Tracker v1: Meal Photos](https://github.com/bhh1893/health-tracker/issues/292). Feeds [Processing a Meal Photo](https://github.com/bhh1893/health-tracker/issues/298) and [Meal Photo limits, quotas and threat model](https://github.com/bhh1893/health-tracker/issues/300). Facts only; the design belongs to those tickets.

Setting: iPhone home-screen web app (React + Vite in `services/web`), FastAPI in `services/api`, up to 10 photos per Meal from camera or library via `<input type="file">`. Checked 2026-11-27. Where a claim rests on WebKit source rather than Apple docs or release notes, it says so: source on `main` can be ahead of the Safari on the phone.

## Summary

- **What the picker hands over on iOS depends on `accept`.** Since WebKit [275726@main](https://commits.webkit.org/275726@main) (March 2024), `accept="image/*"` (or no `accept`) asks the photo picker for the *current* representation, so iPhone library photos arrive as **HEIC**. Listing specific types (for example `accept="image/jpeg,image/png"`) asks for the *compatible* representation, which iOS transcodes, in practice to JPEG. Before that change iOS always transcoded to JPEG.
- **Camera captures through the file input are re-encoded by WebKit itself** as JPEG at quality 0.8, named `image.jpg`, with no EXIF carried over (source has `// FIXME: Should EXIF data be maintained?`).
- **GPS:** WebKit's code never strips metadata on the library path; the iOS photo picker does. Reports in WebKit bug 207088 say location is stripped by default, and a WebKit engineer says the iOS 17 picker added a user option to include it. So GPS normally does not arrive, but a user can opt in, and the server must not rely on the client to remove it.
- **Safari can decode HEIC** (Safari 17+: "Added support for HEIC/HEIF images"), so `createImageBitmap` / `<canvas>` can resize an iPhone HEIC in the page. Chrome and Firefox cannot decode HEIC at all.
- **Safari cannot encode WebP** from a canvas: `toBlob("image/webp")` silently returns PNG. JPEG encoding works everywhere.
- **Canvas limits on iOS:** max canvas area is 8192 x 8192 (67.1 MP) since March 2024 (was 4096 x 4096 = 16.8 MP); the separate canvas-memory cap ("Total canvas memory use exceeds the maximum limit") was removed in June 2023, so a page now runs into the whole-process memory limit and the tab is killed (jetsam) instead of getting an exception. No Apple source gives a per-tab memory number or decode times; those need measuring on the phone.
- **Server:** Pillow (13.0.0) + pillow-heif (1.9.0, bundles libheif 1.23.7) can open, check and re-encode both HEIC and JPEG; Pillow drops EXIF/ICC/XMP on save unless passed explicitly (but forwards a JPEG comment by default). pyvips/libvips keeps all metadata by default and needs `keep=none` plus `VIPS_BLOCK_UNTRUSTED`.
- **CVE history is heavy and recent.** Pillow 13.0.0 (Oct 2026) fixed about 50 CVEs, including a heap overflow in its JPEG decoder reachable via `thumbnail()`/`draft()`, and a heap overflow when re-saving a JPEG with an ICC profile and a forwarded comment. libheif had about 30 CVEs in 2026; its HEVC decoder libde265 has 68 entries in NVD. Restricting `Image.open(formats=...)` removes most of Pillow's exposure (TIFF, PSD, PDF, EPS, FPX and similar).

## 1. What the iOS picker hands over

All of this is in [`WKFileUploadPanel.mm`](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/forms/WKFileUploadPanel.mm), the iOS code behind `<input type="file">`.

### Library photos (PHPicker)

- Library picks go through `PHPickerViewController` (migrated from `UIImagePickerController` in October 2022, commit [`b82f73d`](https://github.com/WebKit/WebKit/commit/b82f73d063)). `multiple` maps to `selectionLimit = 0` (unlimited), otherwise 1. If exactly one media type is allowed it sets an images-only or videos-only filter.
- The representation mode is chosen in `_preferredAssetRepresentationMode`:
  - no accepted types, or `UTTypeImage` among them -> `PHPickerConfigurationAssetRepresentationModeCurrent` (no transcode);
  - otherwise -> `...Compatible` (the picker transcodes).
- `accept` is mapped to UTIs in `UTIsForMIMETypes()`: `image/*` becomes `UTTypeImage`; `*/*` means no filter; other MIME types such as `image/jpeg` map through `UTType typeWithMIMEType:`. So `accept="image/*"` gets HEIC originals and `accept="image/jpeg"` gets transcoded files.
- The behaviour came from commit [`0f76043`](https://github.com/WebKit/WebKit/commit/0f76043f78) ("[iOS] Avoid transcoding images on file inputs unless the set of image types is explicitly restricted", [bug 267277](https://bugs.webkit.org/show_bug.cgi?id=267277), 2024-03-06). Its message: "Historically, in WebKit, selected content has always been transcoded to JPEG (for images) and H.264 (for video)... This patch changes the behavior on iOS so that transcoding to the compatible format for images is only performed if the `accept` attribute restricts the set of image types. Videos remain exempted." It added the internal setting `PhotoPickerPrefersOriginalImageFormat`, default `true`.
- Shipping version: not in the Safari 17.5 or 17.6 release notes. From the commit date it most likely first shipped in iOS 18 (inference; verify on the phone). An [Apple forums thread](https://developer.apple.com/forums/thread/743037) from December 2023 (iOS 17) reports `accept="image/*"` still converting, which matches the pre-change behaviour.
- The picker's own **Options** menu (iOS 17+) has a FORMAT choice of Automatic / Current / Most Compatible ([same thread](https://developer.apple.com/forums/thread/743037)), so the user can override the page.
- Image items are wrapped as delivered: `_uploadItemFromResult:` takes the first registered type conforming to `UTTypeImage` and copies the file, keeping its original file name. No re-encode on this path.
- **Live Photos:** the file never mentions them. Because it picks the first type conforming to `UTTypeImage`, a Live Photo arrives as its still image (inference from source).
- **Videos** are still transcoded to QuickTime (`AVAssetExportPresetHighestQuality`) when the picker did not transcode. Not relevant if `accept` is images only.
- The time spent converting is visible to users: the forum post above says "It just looks like nothing happens after you tap 'Add'. The more photos selected, the longer it takes."

### Camera (`UIImagePickerController`)

- `_showCamera` sets media types and device only; it sets no capture format.
- If the result has `UIImagePickerControllerImageURL` it uses that file. For camera shots: "Photos taken with the camera will not have an image URL. Fall back to a JPEG representation." The fallback calls `UIImageJPEGRepresentation` with `compression = 0.8` and writes `image.jpg`.
- There is no `UIImagePickerControllerMediaMetadata` or `CGImageDestination` handling, so no EXIF (date, GPS, camera model) is written. Whether orientation is baked into pixels or written as a tag by `UIImageJPEGRepresentation` is not stated in the source: check on the phone.
- Every camera photo from every user therefore has the same file name, `image.jpg`.

### What format the camera writes in the first place

- iPhone 7 and later capture HEIF/HEVC under Settings > Camera > Formats > High Efficiency; "Most Compatible" makes "All new photos and videos ... use JPEG or H.264 format." [Apple: Using HEIF or HEVC media](https://support.apple.com/en-us/116944)
- Resolution: iPhone 15 Pro through 17 Pro default to 24 MP ([Apple: models with 24 MP default](https://support.apple.com/en-mz/guide/iphone/aside/iph864de02ae/26/ios/26)); 48 MP "HEIF Max" is opt-in via Resolution Control; Night, Live Photo, Portrait and non-1x lenses produce 12 MP (Apple Community and press reports, not Apple docs).
- Pixel sizes: 12 MP is 4032 x 3024, 24 MP is 5712 x 4284, 48 MP is 8064 x 6048 (standard iPhone 4:3 sizes; arithmetic below uses these).

### Pasteboard and drag

- A separate HEIC-to-JPEG transcode exists for paste/drag (`WebPasteboardProxyCocoa.mm`). Since March 2026 ([309872@main](https://commits.webkit.org/309872@main), [bug 310605](https://bugs.webkit.org/show_bug.cgi?id=310605)) it runs only as a site quirk for a few named domains. Not relevant to the file input.

## 2. EXIF metadata through each path

| Path | HEIC/JPEG? | GPS | Other EXIF | Source |
| --- | --- | --- | --- | --- |
| Library, `accept="image/*"` (current) | HEIC (or JPEG if camera set to Most Compatible) | Stripped by the picker unless the user opts in via Options | Kept (date, camera, orientation) per 2023 reports | WebKit source; [bug 207088](https://bugs.webkit.org/show_bug.cgi?id=207088) |
| Library, restricted `accept` (compatible) | JPEG | Stripped by default | Reports conflict; one says converted JPEG lacked EXIF (Dec 2022) | [bug 207088](https://bugs.webkit.org/show_bug.cgi?id=207088) |
| Camera via file input | JPEG q0.8, `image.jpg` | None | None | WebKit source |
| Client canvas re-encode (any) | JPEG/PNG | None | None | see section 3 |

- Bug 207088 ("Uploading photos from iOS photo library strips EXIF data") is RESOLVED CONFIGURATION CHANGED. WebKit engineer Aditya Keerthi (2023-06-09) said the iOS 17 picker includes an option to include location data. User reports from iOS 16.4 to 17 say location is stripped by default while dates and camera settings are kept, and that camera captures have metadata stripped. These are user reports, not Apple documentation.
- Implication for #300: GPS can still arrive (user toggles location on, or a file from Files/iCloud Drive, or a crafted request). The server has to strip it regardless of what the client does.

## 3. Decoding, resizing and re-encoding in the page

### Decode

- Safari 17 release notes, Images: "Added support for HEIC/HEIF images." ([Safari 17 Release Notes](https://developer.apple.com/documentation/safari-release-notes/safari-17-release-notes)). caniuse lists HEIF as supported in iOS Safari 17.0+ and unsupported in Chrome, Chrome for Android and Firefox ([caniuse data](https://github.com/Fyrd/caniuse/blob/main/features-json/heif.json)). So a HEIC `File` can go straight into `createImageBitmap()` or an `<img>` on the iPhone, but not on Android or desktop Chrome.

### APIs and support (MDN browser-compat-data)

| Feature | Safari | Chrome | Note |
| --- | --- | --- | --- |
| `createImageBitmap(blob)` | 15 | 50 | |
| `resizeWidth` / `resizeHeight` / `resizeQuality` | 15 | 54 | `resizeQuality` default `low` |
| `imageOrientation: "from-image"` | 16 | 112 | default: apply EXIF orientation |
| `OffscreenCanvas` + 2d context + `convertToBlob` | 16.4 | 69 | can run in a Worker |
| `canvas.toBlob` JPEG + quality | 11 | 50 | |
| `toBlob` / `convertToBlob` WebP | **no** | 50 | |
| CSS `image-orientation: from-image` | 13.1 | 81 | |

Source: [mdn/browser-compat-data](https://github.com/mdn/browser-compat-data) (`api/_globals/createImageBitmap.json`, `api/OffscreenCanvas.json`, `api/HTMLCanvasElement.json`, `css/properties/image-orientation.json`). MDN on `imageOrientation`: `from-image` is "Image oriented according to EXIF orientation metadata, if present (default)." ([MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap))

- WebKit's `toEncodingMimeType` returns `"image/png"` for any type it cannot encode ([`HTMLCanvasElement.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLCanvasElement.cpp)). A request for WebP on the iPhone yields a PNG, many times larger than the JPEG; check `blob.type`.
- Quality outside 0..1 or non-numeric is ignored (`qualityFromJSValue`).
- Canvas output is built from the bitmap's pixels, so a canvas re-encode carries no EXIF, GPS or ICC tag. Orientation is fixed by the decode step (`from-image`), so the output pixels are upright.

### Canvas size and memory limits on iOS

- `maxCanvasArea()` in [`CanvasBase.cpp`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp): `8192 * 8192` on `PLATFORM(IOS_FAMILY)`, `16384 * 16384` elsewhere. Exceeding it logs "Canvas area exceeds the maximum limit" and the canvas fails. Raised from 4096 x 4096 by [`d1f63c0`](https://github.com/WebKit/WebKit/commit/d1f63c061e) (276145@main, 2024-03-15): "The jetsam limit on iOS has been raised." OffscreenCanvas uses the same checks (commit `d21c61e`, December 2022).
- The total canvas memory cap (224 to 384 MB in older iOS, error "Total canvas memory use exceeds the maximum limit") was deleted by [`6bd11f3`](https://github.com/WebKit/WebKit/commit/6bd11f3792f05b4e58e5647bf173212879fa62cc) (265628@main, 2023-06-29, shipped as "Fixed Canvas context allocation failures due to exceeding the maximum canvas memory limit" in Safari 17). Its message: "we've decided to remove the canvas limit and just let the page follow the same memory restrictions as all other Web features. This might mean more pages crash (jetsam) than break."
- So on current iOS a too-large decode does not throw; the web content process can be killed and the page reloads. Apple publishes no per-tab memory figure.
- Decoded size at 4 bytes per pixel (arithmetic): 12 MP is about 49 MB, 24 MP about 98 MB, 48 MP about 195 MB per image. A 48 MP photo fits under the 67 MP canvas area, but you never need a full-size canvas: decode with `resizeWidth`/`resizeHeight` and draw into a small canvas. Whether WebKit's `createImageBitmap(blob, {resizeWidth})` decodes at reduced size or decodes full and then scales is not documented; assume the full decode cost.
- **No primary source gives decode or encode times for 12-48 MP on an iPhone.** Measure with a throwaway prototype (Safari Web Inspector, one image at a time, 10 in sequence) before #298 relies on client resizing.

### Android Chrome

- Chrome cannot decode HEIC (above). Android cameras mostly write JPEG; where a device writes HEIF, the page cannot resize it.
- Android 10+ redacts location from EXIF for apps without `ACCESS_MEDIA_LOCATION` ([Android: access media files](https://developer.android.com/training/data-storage/shared/media)). The system Photo Picker strips location even for apps that hold the permission ([issue 243294058](https://issuetracker.google.com/issues/243294058)); press reports say an August 2026 Mainline update added a per-app user toggle to include it ([Android Authority](https://androidauthority.com/android-photo-picker-location-sharing-release-3704689)).
- Not verified: whether Chrome's `<input accept="image/*">` uses the system Photo Picker or its own picker on a given Android version (Chromium `SelectFileDialog.java` could not be fetched). Community reports say image-only `accept` hides the camera option on recent Android ([test page](https://mofef.github.io/android_camera_test.html)).

## 4. Server-side Python libraries

Versions on PyPI on 2026-11-27: `pillow` 13.0.0 (2026-10-16), `pillow-heif` 1.9.0 (2026-11-24), `pyvips` 3.2.0 (2026-08-29).

### Pillow

- `Image.open(fp, mode="r", formats=None)`: `formats` is "A list or tuple of formats to attempt to load the file in"; `None` tries every plugin. Opening is lazy: pixels are read on `load()`. ([Pillow Image docs](https://pillow.readthedocs.io/en/stable/reference/Image.html))
- **Decompression bombs:** `MAX_IMAGE_PIXELS = int(1024 * 1024 * 1024 // 4 // 3)` = 89,478,485 ("approximately 0.25GB for a 24-bit (3 bpp) image"). Above it Pillow issues `DecompressionBombWarning`; above twice it raises `DecompressionBombError`. The check runs inside `Image.open()` on the header size for every plugin, including third-party ones like pillow-heif ([`Image.py`](https://github.com/python-pillow/Pillow/blob/main/src/PIL/Image.py)). A 48 MP photo is under the warning line. The warning is only a warning unless turned into an error.
- `verify()`: "If you need to load the image after using this method, you must reopen the image file."
- `thumbnail()` preserves aspect and uses `draft()` for JPEG (decode at reduced scale) when `reducing_gap` is set (default 2.0).
- **Orientation:** `ImageOps.exif_transpose()`: "If an image has an EXIF Orientation tag, other than 1, transpose the image accordingly, and remove the orientation data." ([`ImageOps.py`](https://github.com/python-pillow/Pillow/blob/main/src/PIL/ImageOps.py))
- **What survives a save:** `Image.save()` builds `encoderinfo` only from the keyword arguments passed. The JPEG writer uses `info.get("exif", b"")`, `info.get("icc_profile")` and `info.get("xmp")` from those arguments, so EXIF, GPS, ICC and XMP are dropped unless passed. The exception is the JPEG comment: `comment = info.get("comment", im.info.get("comment"))` forwards the source's COM marker by default ([`JpegImagePlugin.py`](https://github.com/python-pillow/Pillow/blob/main/src/PIL/JpegImagePlugin.py)). WebP save behaves the same for EXIF/ICC/XMP ([`WebPImagePlugin.py`](https://github.com/python-pillow/Pillow/blob/main/src/PIL/WebPImagePlugin.py)).
- Dropping the ICC profile matters for colour: an image in a wide-gamut profile saved without it will be read as sRGB and look duller (general colour management fact; check whether sample iPhone files carry Display P3).

### pillow-heif

- Pillow plugin (`register_heif_opener()`), bundles libheif. 1.9.0 requires Pillow 13.0.0 and libheif 1.23.7, and from 1.9.0 `Image.open()` with a path reads only metadata until `load()` ([CHANGELOG](https://github.com/bigcat88/pillow_heif/blob/master/CHANGELOG.md)).
- Options ([docs](https://pillow-heif.readthedocs.io/en/latest/options.html)): `DISABLE_SECURITY_LIMITS = False`, `THUMBNAILS = True`, `DEPTH_IMAGES = True`, `AUX_IMAGES = True`, `DECODE_THREADS = 4`. Thumbnails, depth maps and auxiliary images are extra decoded items; turning them off reduces parsing surface (inference).
- libheif's default security limits ([`security_limits.cc`](https://github.com/strukturag/libheif/blob/master/libheif/security_limits.cc)): `max_image_size_pixels = 32768 * 32768` (about 1.07 GP), `max_total_memory = 4 GiB`, `max_number_of_tiles = 4096 * 4096`, `max_items = 1000`, `max_color_profile_size = 100 MiB`. These are far looser than Pillow's 89 MP check, which therefore is the effective guard.
- Advisories: [GHSA-5gjj-6r7v-ph3x](https://github.com/bigcat88/pillow_heif/security) / CVE-2026-28231 (High, fixed 1.3.0, encode path heap OOB read) and GHSA-ccw6-q225-c975 (Moderate, Sept 2026, encode path stride). Both in encoding, not decoding.

### pyvips / libvips

- `pip install "pyvips[binary]"` installs a self-contained libvips ([README](https://github.com/libvips/pyvips/blob/master/README.rst)).
- libvips checklist: "If you are handling untrusted data, I would set the `VIPS_BLOCK_UNTRUSTED` env var" and "only use the loaders we have tested for security"; "The most important sanity check is for image dimensions to protect yourself from decompression bombs"; `vips_thumbnail()` "combines load and resize into one step" with shrink-on-load; disable the operation cache for many different images ([developer checklist](https://www.libvips.org/API/current/developer-checklist.html)). pyvips exposes `block_untrusted_set()` and `operation_block_set()` (libvips 8.13+, [`voperation.py`](https://github.com/libvips/pyvips/blob/master/pyvips/voperation.py)).
- libvips has **no** built-in pixel-count limit equivalent to Pillow's; the caller checks width and height after the header load.
- Metadata: savers' `keep` option "defaults to all"; `keep=none` removes everything (`strip` deprecated in 8.15) ([What's new in 8.15](https://www.libvips.org/2023/10/10/What's-new-in-8.15.html)). Forgetting it keeps GPS.
- Cautionary CVE: [CVE-2026-66066](https://nvd.nist.gov/vuln/detail/CVE-2026-66066) (Critical): Rails Active Storage "does not disable libvips operations" marked untrusted.

## 5. CVE history (what matters for a JPEG/HEIC pipeline)

Counts from [OSV](https://osv.dev) (PyPI) and [NVD](https://nvd.nist.gov) keyword search, 2026-11-27.

**Pillow:** about 200 OSV records since 2014. Most are in formats a photo endpoint never needs (TIFF, PSD, PDF, EPS, FLI, PCX, SGI, BLP, FPX, MSP, XBM). The ones on the JPEG/WebP/EXIF path:

| CVE | Fixed in | What | Why it matters here |
| --- | --- | --- | --- |
| CVE-2026-112403 ([GHSA-8g5g-8vmr-9782](https://github.com/python-pillow/Pillow/security/advisories/GHSA-8g5g-8vmr-9782)) | 13.0.0 | JPEG decoder heap overflow when `draft()`/`thumbnail()` downscales a lossless SOF3 JPEG with libjpeg-turbo 3.x; "potentially allow code execution" | exactly the resize path |
| CVE-2026-96778 ([GHSA-g7cr-3p24-7wf7](https://github.com/python-pillow/Pillow/security/advisories/GHSA-g7cr-3p24-7wf7)) | 13.0.0 | heap overflow re-saving JPEG "while preserving its ICC profile and forwarded comment" | comment is forwarded by default |
| CVE-2026-128066 ([GHSA-wqgw-9xfh-qf2g](https://github.com/python-pillow/Pillow/security/advisories/GHSA-wqgw-9xfh-qf2g)) | 13.0.0 | quadratic memory in EXIF IFD parsing, reachable via `getexif()` / `exif_transpose()` on JPEG, PNG, WebP, MPO | orientation fix path |
| CVE-2026-96636 ([GHSA-p8hx-v2p6-rp84](https://github.com/python-pillow/Pillow/security/advisories/GHSA-p8hx-v2p6-rp84)) | 13.0.0 | bomb check bypass via MPO/DCX `seek()` to a later frame | MPO is a JPEG variant; only if you seek frames |
| CVE-2026-96643 | 13.0.0 | quadratic EXIF parsing via PNG eXIf | PNG upload |
| CVE-2023-4863 / PYSEC-2023-175 | 10.0.1 | libwebp heap overflow in bundled wheels (exploited in the wild in browsers) | WebP decode |
| CVE-2023-50447, CVE-2022-22817 | 10.2.0, 9.0.0 | code execution via `ImageMath.eval` | only if used |

Pillow's wheels bundle libjpeg-turbo, libwebp, libopenjp2 and others, so some fixes are library bumps (for example GHSA-78g4-xqwv-q3g8, bundled libopenjp2).

**libheif:** 51 NVD entries, about 30 published in 2026, many High and one Critical ([CVE-2026-84383](https://nvd.nist.gov/vuln/detail/CVE-2026-84383), item graph with nested `iden`/`auxl`, fixed 1.23.2). Recurring areas: grid/overlay/`iden` item graphs, the uncompressed `unci` codec, image sequences, region masks. Latest fixed line: 1.23.3 (CVE-2026-120208); pillow-heif 1.9.0 bundles 1.23.7.

**libde265** (the HEVC decoder libheif uses for HEIC): 68 NVD entries, including 2026 heap overflows fixed in 1.1.0 and 1.1.1.

**libvips:** 32 NVD entries; 2026 fixes in 8.18.3 for TIFF, Radiance and EXIF decoding (CVE-2026-35590: EXIF decoder "was not verifying the range").

Pattern: decoders for complex container formats (HEIF item graphs, TIFF IFDs, EXIF) produce a steady stream of memory-safety bugs. A HEIC upload path pulls in two of the busiest (libheif, libde265).

## Implications for #298 and #300 (not decisions)

- `accept="image/*"` means the server receives HEIC from the iPhone; a restricted `accept` makes iOS transcode to JPEG before upload, at the cost of the visible "nothing happens" delay and a user-overridable Options menu.
- Client-side resize-to-JPEG via `createImageBitmap` + canvas works on iOS 17+ for HEIC and would shrink uploads, strip metadata and fix orientation, but cannot be trusted for security: the server still has to re-decode, re-encode and strip.
- If the server never accepts HEIC (client always sends JPEG), libheif and libde265 leave the attack surface. If it does, pillow-heif must be kept current.
- Whatever library: allowlist formats at open, enforce a pixel cap at header time, reject multi-frame, re-encode to fresh pixels, write no source metadata (including the JPEG comment), stay on current releases, and run the decode in a process that can die without taking the API down.

## Open questions

- On a real iPhone running the current iOS: does `accept="image/*"` return HEIC, and does camera capture keep orientation upright?
- Decode and resize time and peak memory for 10 photos at 12, 24 and 48 MP in the home-screen web app.
- Whether `createImageBitmap(blob, {resizeWidth})` in WebKit avoids a full-size decode.
- Exact Apple wording of `PHPickerConfiguration.AssetRepresentationMode` (Apple's docs pages could not be fetched as text).
- Chrome for Android's picker path per Android version.
