// PROTOTYPE, throwaway (issue #302). The parts every variant shares: the sheet's
// photo draft, the system picker, the full-screen viewer, and small status marks.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { uuidv7 } from "../../src/lib/uuidv7";
import { MAX_PHOTOS, type Photo, type PhotoDraft } from "./store";

// The sheet's photos, held on the phone until Save (ADR 0038). In-flight photos
// from an earlier Save show but cannot be removed until they settle.
export function usePhotoDraft(photos: Photo[]) {
  const [kept, setKept] = useState(() => photos.filter((p) => p.status === "saved"));
  const [added, setAdded] = useState<{ id: string; url: string }[]>([]);
  const [inFlight] = useState(() => photos.filter((p) => p.status !== "saved" && p.status !== "deleting"));
  const [note, setNote] = useState<string | null>(null);
  const count = kept.length + added.length + inFlight.length;
  const room = MAX_PHOTOS - count;

  function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = [...files];
    const taken = list.slice(0, room);
    // IDs minted in pick order, so the server's ID order is the pick order.
    setAdded((a) => [...a, ...taken.map((f) => ({ id: uuidv7(), url: URL.createObjectURL(f) }))]);
    setNote(
      taken.length < list.length
        ? `Added ${String(taken.length)} of ${String(list.length)}. A Meal holds at most ${String(MAX_PHOTOS)} photos.`
        : null,
    );
  }

  function remove(id: string) {
    setKept((k) => k.filter((p) => p.id !== id));
    setAdded((a) => a.filter((p) => p.id !== id));
    setNote(null);
  }

  // Everything the sheet shows, in order: saved, then in flight, then new.
  const all: (Photo & { isNew?: boolean })[] = [
    ...kept,
    ...inFlight,
    ...added.map((a) => ({ ...a, status: "saved" as const, progress: 1, isNew: true })),
  ];
  const draft: PhotoDraft = { kept, added };
  return { all, count, room, full: room <= 0, add, remove, note, draft, removable: (p: Photo) => p.status === "saved" };
}

// A hidden file input and a button that opens it. accept="image/*" gives iOS its
// "Photo Library / Take Photo / Choose File" menu; capture opens the camera directly.
export function PickButton({
  onPick,
  capture,
  multiple = true,
  disabled,
  className,
  children,
}: {
  onPick: (files: FileList | null) => void;
  capture?: boolean;
  multiple?: boolean;
  disabled?: boolean;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={multiple}
        {...(capture ? { capture: "environment" } : {})}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" disabled={disabled} className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
    </>
  );
}

// Full screen, one photo at a time, swipe sideways (CSS scroll snap). Optional
// actions per photo, e.g. Remove inside the sheet.
export function Viewer({
  photos,
  start,
  onClose,
  action,
}: {
  photos: { id: string; url: string }[];
  start: number;
  onClose: () => void;
  action?: { label: string; run: (id: string) => void };
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  useEffect(() => {
    const el = strip.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const current = photos[index];
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#000]">
      <div className="flex items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-on-fill">
        <span className="text-sm">
          {index + 1} / {photos.length}
        </span>
        <button type="button" aria-label="Close" className="rounded-full px-3 py-1 text-2xl" onClick={onClose}>
          ✕
        </button>
      </div>
      <div
        ref={strip}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {photos.map((p) => (
          <div key={p.id} className="flex w-full shrink-0 snap-center items-center justify-center">
            <img src={p.url} alt="" className="max-h-full max-w-full object-contain" />
          </div>
        ))}
      </div>
      {action && current && (
        <div className="flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            className="rounded-xl bg-danger px-6 py-3 font-semibold text-on-fill"
            onClick={() => {
              action.run(current.id);
              if (photos.length <= 1) onClose();
              else setIndex(Math.min(index, photos.length - 2));
            }}
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}

// A ring that fills as the upload goes. Queued photos show an empty ring.
export function Ring({ progress, size = 28 }: { progress: number; size?: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.4)" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeDasharray={`${String(c * progress)} ${String(c)}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

export function CameraIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
