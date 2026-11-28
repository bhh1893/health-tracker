// PROTOTYPE, throwaway (issue #302).
// C: Photo chip + upload tray. The card stays as it is today plus a "📷 3" chip
// beside the pencil; tap it for a full-screen grid, then one photo. All upload
// progress and failures live in one tray above the Add buttons, for every Meal at
// once, which expands to a per-photo list with Retry / ✕. The sheet's grid puts the
// Add tile last (where a new photo lands), and removing happens in the viewer.
import { useEffect, useState } from "react";

import type { Variant } from "./App";
import { CameraIcon, PickButton, Ring, Viewer } from "./shared";
import { broken, discard, MAX_PHOTOS, pending, retry, useMeals, visible } from "./store";

function Gallery({ photos, onClose }: { photos: { id: string; url: string }[]; onClose: () => void }) {
  const [one, setOne] = useState<number | null>(null);
  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-page">
      <div className="flex items-center justify-between p-4">
        <span className="font-semibold">{photos.length} photos</span>
        <button type="button" aria-label="Close" className="text-2xl text-faint" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1 overflow-y-auto px-1">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setOne(i);
            }}
          >
            <img src={p.url} alt="" className="aspect-square w-full object-cover" />
          </button>
        ))}
      </div>
      {one !== null && (
        <Viewer
          photos={photos}
          start={one}
          onClose={() => {
            setOne(null);
          }}
        />
      )}
    </div>
  );
}

function Tray() {
  const meals = useMeals();
  const [expanded, setExpanded] = useState(false);
  const rows = meals.flatMap((m) =>
    visible(m.photos)
      .filter((p) => pending(p) || broken(p))
      .map((p) => ({ p, meal: m.label ?? "Meal" })),
  );
  const up = rows.filter(({ p }) => pending(p));
  const bad = rows.filter(({ p }) => broken(p));
  // Say "saved" for a moment once the queue empties without failures.
  const [justDone, setJustDone] = useState(false);
  const [had, setHad] = useState(false);
  if (rows.length > 0 && !had) setHad(true);
  if (rows.length === 0 && had) {
    setHad(false);
    setJustDone(true);
  }
  useEffect(() => {
    if (!justDone) return;
    const t = setTimeout(() => {
      setJustDone(false);
    }, 2000);
    return () => {
      clearTimeout(t);
    };
  }, [justDone]);

  if (rows.length === 0) {
    return justDone ? (
      <div className="sticky bottom-[calc(var(--tab-bar-footprint)+var(--tab-bar-gap)+4.5rem)] rounded-2xl bg-food-soft p-3 text-sm text-food shadow">
        ✓ Photos saved
      </div>
    ) : null;
  }
  const progress = up.reduce((s, { p }) => s + p.progress, 0) / Math.max(up.length, 1);
  return (
    <div className="sticky bottom-[calc(var(--tab-bar-footprint)+var(--tab-bar-gap)+4.5rem)] z-10 rounded-2xl border border-edge bg-card shadow-lg">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-3 text-left text-sm"
        onClick={() => {
          setExpanded((e) => !e);
        }}
      >
        {up.length > 0 ? <Ring progress={progress} size={24} /> : <span className="text-lg text-danger">!</span>}
        <span className="flex-1">
          {up.length > 0 && `Uploading ${String(up.length)} photo${up.length === 1 ? "" : "s"}`}
          {up.length > 0 && bad.length > 0 && " · "}
          {bad.length > 0 && <span className="text-danger">{bad.length} failed</span>}
        </span>
        <span className="text-faint">{expanded ? "▾" : "▴"}</span>
      </button>
      {expanded && (
        <ul className="max-h-60 divide-y divide-edge overflow-y-auto border-t border-edge">
          {rows.map(({ p, meal }) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <img src={p.url} alt="" className="size-10 rounded object-cover" />
              <span className="flex-1">
                {meal}
                <span className="block text-xs text-faint">
                  {p.status === "queued" && "Waiting"}
                  {p.status === "uploading" && `${String(Math.round(p.progress * 100))}%`}
                  {p.status === "failed" && <span className="text-danger">Didn&apos;t upload</span>}
                  {p.status === "delete-failed" && <span className="text-danger">Couldn&apos;t remove</span>}
                </span>
              </span>
              {broken(p) && (
                <button
                  type="button"
                  className="font-semibold text-action"
                  onClick={() => {
                    retry(p.id);
                  }}
                >
                  Retry
                </button>
              )}
              {p.status === "failed" && (
                <button
                  type="button"
                  aria-label="Discard"
                  className="px-2 text-danger"
                  onClick={() => {
                    discard(p.id);
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const variantC: Variant = {
  key: "C",
  name: "Chip + upload tray",
  Card({ meal, title, pencil, contents }) {
    const [open, setOpen] = useState(false);
    const shown = visible(meal.photos).filter((p) => p.status === "saved");
    return (
      <article className="rounded-2xl border border-edge bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          {title}
          <span className="flex items-center gap-3">
            {shown.length > 0 && (
              <button
                type="button"
                className="flex items-center gap-1 rounded-full bg-inset px-2 py-1 text-sm text-action"
                onClick={() => {
                  setOpen(true);
                }}
              >
                <CameraIcon className="size-4" /> {shown.length}
              </button>
            )}
            {pencil}
          </span>
        </div>
        {contents}
        {open && (
          <Gallery
            photos={shown}
            onClose={() => {
              setOpen(false);
            }}
          />
        )}
      </article>
    );
  },
  SheetPhotos({ d }) {
    const [one, setOne] = useState<number | null>(null);
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-muted">Photos</span>
        <div className="grid grid-cols-4 gap-2">
          {d.all.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setOne(i);
              }}
            >
              <img src={p.url} alt="" className={`aspect-square w-full rounded-lg object-cover ${pending(p) ? "opacity-50" : ""}`} />
            </button>
          ))}
          {!d.full && (
            <PickButton
              onPick={d.add}
              className="flex aspect-square flex-col items-center justify-center rounded-lg border-2 border-dashed border-field text-action"
            >
              <span className="text-2xl leading-none">+</span>
              <span className="text-xs">{d.count === 0 ? "Add photo" : `${String(d.count)} / ${String(MAX_PHOTOS)}`}</span>
            </PickButton>
          )}
        </div>
        {d.full && <p className="text-sm text-muted">{MAX_PHOTOS} of {MAX_PHOTOS}. Remove one to add another.</p>}
        {d.note && <p className="text-sm text-muted">{d.note}</p>}
        {one !== null && d.all.length > 0 && (
          <Viewer
            photos={d.all}
            start={Math.min(one, d.all.length - 1)}
            onClose={() => {
              setOne(null);
            }}
            action={{ label: "Remove photo", run: d.remove }}
          />
        )}
      </div>
    );
  },
  WindowExtra: Tray,
};
