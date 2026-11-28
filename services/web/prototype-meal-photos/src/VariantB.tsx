// PROTOTYPE, throwaway (issue #302).
// B: Cover photo + status line. The first photo is a wide banner across the top of
// the card with a count badge; tap it to page through all of them. Uploads are one
// line at the bottom of the card ("Uploading 2 of 3" with a bar), and failures one
// line with Retry all / Discard. The sheet has separate Camera and Library buttons
// and a three-column grid, each photo with its own Remove.
import { useState } from "react";

import type { Variant } from "./App";
import { CameraIcon, PickButton, Viewer } from "./shared";
import { broken, discard, MAX_PHOTOS, pending, retry, visible } from "./store";

export const variantB: Variant = {
  key: "B",
  name: "Cover + status line",
  Card({ meal, title, pencil, contents }) {
    const [open, setOpen] = useState(false);
    const photos = visible(meal.photos);
    const shown = photos.filter((p) => p.status === "saved");
    const up = photos.filter(pending);
    const bad = photos.filter(broken);
    const done = up.reduce((s, p) => s + p.progress, 0) / Math.max(up.length, 1);
    const cover = shown[0];
    return (
      <article className="overflow-hidden rounded-2xl border border-edge bg-card shadow-sm">
        {cover && (
          <button
            type="button"
            className="relative block aspect-[16/9] w-full"
            onClick={() => {
              setOpen(true);
            }}
          >
            <img src={cover.url} alt="" className="size-full object-cover" />
            {shown.length > 1 && (
              <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-ink/70 px-2 py-0.5 text-sm text-on-fill">
                <CameraIcon className="size-4" /> {shown.length}
              </span>
            )}
          </button>
        )}
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            {title}
            {pencil}
          </div>
          {contents}
          {up.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              <p className="text-sm text-muted">
                Uploading {up.length === 1 ? "1 photo" : `${String(up.length)} photos`}...
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-inset">
                <div className="h-full bg-action transition-all" style={{ width: `${String(done * 100)}%` }} />
              </div>
            </div>
          )}
          {bad.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm">
              <span className="text-danger">
                {bad.length === 1 ? "1 photo" : `${String(bad.length)} photos`}{" "}
                {bad.every((p) => p.status === "delete-failed") ? "couldn't be removed" : "didn't upload"}
              </span>
              <span className="flex gap-3">
                <button
                  type="button"
                  className="font-semibold text-action"
                  onClick={() => {
                    bad.forEach((p) => {
                      retry(p.id);
                    });
                  }}
                >
                  Retry
                </button>
                {bad.some((p) => p.status === "failed") && (
                  <button
                    type="button"
                    className="text-danger"
                    onClick={() => {
                      bad.filter((p) => p.status === "failed").forEach((p) => {
                        discard(p.id);
                      });
                    }}
                  >
                    Discard
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
        {open && shown.length > 0 && (
          <Viewer
            photos={shown}
            start={0}
            onClose={() => {
              setOpen(false);
            }}
          />
        )}
      </article>
    );
  },
  SheetPhotos({ d }) {
    const btn =
      "flex flex-1 items-center justify-center gap-2 rounded-xl border border-field p-3 text-action disabled:text-disabled";
    return (
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex gap-3">
          <PickButton onPick={d.add} capture multiple={false} disabled={d.full} className={btn}>
            <CameraIcon /> Camera
          </PickButton>
          <PickButton onPick={d.add} disabled={d.full} className={btn}>
            Library
          </PickButton>
        </div>
        {d.full && <p className="text-sm text-muted">A Meal holds at most {MAX_PHOTOS} photos. Remove one to add another.</p>}
        {d.note && <p className="text-sm text-muted">{d.note}</p>}
        {d.all.length > 0 && (
          <div className="grid grid-cols-3 gap-2 overflow-y-auto">
            {d.all.map((p) => (
              <div key={p.id} className="flex flex-col gap-1">
                <img src={p.url} alt="" className={`aspect-square w-full rounded-lg object-cover ${pending(p) ? "opacity-50" : ""}`} />
                {d.removable(p) ? (
                  <button
                    type="button"
                    className="text-sm text-action"
                    onClick={() => {
                      d.remove(p.id);
                    }}
                  >
                    Remove
                  </button>
                ) : (
                  <span className="text-center text-xs text-faint">Uploading</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
};
