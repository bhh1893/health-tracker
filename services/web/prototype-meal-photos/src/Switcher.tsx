// PROTOTYPE, throwaway (issue #302). Floating variant switcher plus the network
// simulator; neither is part of any design. Sits where the real tab bar would.
import { useEffect, useState } from "react";

import { sim } from "./store";

export function Switcher(props: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
}) {
  const [, rerender] = useState(0);
  const [open, setOpen] = useState(false);
  const i = Math.max(0, props.variants.findIndex((v) => v.key === props.current));
  const n = props.variants.length;
  const step = (d: number) => {
    const next = props.variants[(i + d + n) % n];
    if (next) props.onChange(next.key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  });

  const v = props.variants[i];
  const pill = "rounded-full px-3 py-1";
  return (
    <div className="fixed bottom-[var(--tab-bar-lift)] left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
      {open && (
        <div className="flex flex-col gap-2 rounded-2xl bg-[#5b21b6] p-3 text-sm text-on-fill shadow-xl">
          <div className="flex items-center gap-1">
            <span className="w-16">Uploads</span>
            {(["none", "some", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`${pill} ${sim.fail === f ? "bg-on-fill text-[#5b21b6]" : ""}`}
                onClick={() => {
                  sim.fail = f;
                  rerender((x) => x + 1);
                }}
              >
                {f === "none" ? "work" : f === "some" ? "flaky" : "fail"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="w-16">Network</span>
            {[false, true].map((s) => (
              <button
                key={String(s)}
                type="button"
                className={`${pill} ${sim.slow === s ? "bg-on-fill text-[#5b21b6]" : ""}`}
                onClick={() => {
                  sim.slow = s;
                  rerender((x) => x + 1);
                }}
              >
                {s ? "slow" : "fast"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex h-12 items-center gap-1 rounded-full bg-[#5b21b6] px-2 text-sm text-on-fill shadow-xl ring-2 ring-on-fill">
        <button type="button" onClick={() => { step(-1); }} className="px-3 py-2" aria-label="Previous variant">
          ←
        </button>
        <span className="whitespace-nowrap">
          {v?.key} ({v?.name})
        </span>
        <button type="button" onClick={() => { step(1); }} className="px-3 py-2" aria-label="Next variant">
          →
        </button>
        <button type="button" onClick={() => { setOpen((o) => !o); }} className="px-3 py-2" aria-label="Network simulator">
          ⚙
        </button>
      </div>
    </div>
  );
}
