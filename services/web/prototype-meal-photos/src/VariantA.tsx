// PROTOTYPE, throwaway (issue #302).
// A: Thumbnail strip. Every photo is a small square in a sideways-scrolling row
// under the Meal's contents. Upload state lives on each thumbnail: a progress ring
// while uploading, a red ↻ when it failed (tap for Retry / Discard). The sheet uses
// the same strip with an Add tile first and a ✕ on each photo.
import { useState } from "react";

import type { Variant } from "./App";
import { CameraIcon, PickButton, Ring, Viewer } from "./shared";
import { broken, discard, MAX_PHOTOS, pending, retry, visible, type Photo } from "./store";

function Thumb({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  const [menu, setMenu] = useState(false);
  const bad = broken(photo);
  return (
    <div className="relative size-16 shrink-0">
      <button
        type="button"
        className={`size-16 overflow-hidden rounded-lg ${bad ? "ring-2 ring-danger" : ""}`}
        onClick={() => {
          if (bad) setMenu((m) => !m);
          else onOpen();
        }}
      >
        <img src={photo.url} alt="" className={`size-full object-cover ${pending(photo) || bad ? "opacity-50" : ""}`} />
      </button>
      {pending(photo) && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Ring progress={photo.status === "queued" ? 0 : photo.progress} />
        </span>
      )}
      {bad && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-bold text-danger">
          ↻
        </span>
      )}
      {menu && (
        <div className="absolute top-full left-0 z-10 mt-1 flex w-36 flex-col rounded-xl border border-edge bg-card text-sm shadow-lg">
          <p className="px-3 pt-2 text-xs text-danger">
            {photo.status === "delete-failed" ? "Couldn't remove." : "Didn't upload."}
          </p>
          <button
            type="button"
            className="px-3 py-2 text-left text-action"
            onClick={() => {
              setMenu(false);
              retry(photo.id);
            }}
          >
            Retry
          </button>
          {photo.status === "failed" && (
            <button
              type="button"
              className="px-3 py-2 text-left text-danger"
              onClick={() => {
                discard(photo.id);
              }}
            >
              Discard
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export const variantA: Variant = {
  key: "A",
  name: "Thumbnail strip",
  Card({ meal, title, pencil, contents }) {
    const [open, setOpen] = useState<number | null>(null);
    const photos = visible(meal.photos);
    const viewable = photos.filter((p) => p.status === "saved");
    return (
      <article className="rounded-2xl border border-edge bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          {title}
          {pencil}
        </div>
        {contents}
        {photos.length > 0 && (
          <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
            {photos.map((p) => (
              <Thumb
                key={p.id}
                photo={p}
                onOpen={() => {
                  setOpen(Math.max(0, viewable.findIndex((v) => v.id === p.id)));
                }}
              />
            ))}
          </div>
        )}
        {open !== null && viewable.length > 0 && (
          <Viewer
            photos={viewable}
            start={open}
            onClose={() => {
              setOpen(null);
            }}
          />
        )}
      </article>
    );
  },
  SheetPhotos({ d }) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted">
          Photos {d.count} / {MAX_PHOTOS}
        </span>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pt-2 pb-1">
          {!d.full && (
            <PickButton
              onPick={d.add}
              className="flex size-16 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-field text-action"
            >
              <CameraIcon />
              <span className="text-xs">Add</span>
            </PickButton>
          )}
          {d.all.map((p) => (
            <div key={p.id} className="relative size-16 shrink-0">
              <img src={p.url} alt="" className={`size-16 rounded-lg object-cover ${pending(p) ? "opacity-50" : ""}`} />
              {d.removable(p) && (
                <button
                  type="button"
                  aria-label="Remove photo"
                  className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-ink text-xs text-on-fill"
                  onClick={() => {
                    d.remove(p.id);
                  }}
                >
                  ✕
                </button>
              )}
              {p.isNew && (
                <span className="absolute bottom-0.5 left-0.5 rounded bg-ink/70 px-1 text-[10px] text-on-fill">new</span>
              )}
            </div>
          ))}
        </div>
        {d.full && <p className="text-sm text-muted">A Meal holds at most {MAX_PHOTOS} photos. Remove one to add another.</p>}
        {d.note && <p className="text-sm text-muted">{d.note}</p>}
      </div>
    );
  },
};
