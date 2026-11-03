// PROTOTYPE, throwaway (issue #14). Floating variant switcher; not part of any design.
import { useEffect } from "react";

export function Switcher(props: {
  variants: { key: string; name: string }[];
  current: string;
  onChange: (key: string) => void;
}) {
  const i = props.variants.findIndex((v) => v.key === props.current);
  const step = (d: number) => props.onChange(props.variants[(i + d + props.variants.length) % props.variants.length].key);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const v = props.variants[i];
  return (
    <div className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-fuchsia-700 px-2 py-1 text-sm text-white shadow-xl ring-2 ring-white">
      <button onClick={() => step(-1)} className="px-3 py-2" aria-label="Previous variant">
        ←
      </button>
      <span className="whitespace-nowrap">
        {v.key} ({v.name})
      </span>
      <button onClick={() => step(1)} className="px-3 py-2" aria-label="Next variant">
        →
      </button>
    </div>
  );
}
