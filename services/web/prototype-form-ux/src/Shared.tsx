// PROTOTYPE, throwaway (issue #14). Small pieces every variant may reuse.
import type { ReactNode } from "react";
import type { Unit } from "./stub";

// Shows what the client would send, so every variant's output is visible (prototype rule: surface the state).
export function Payload({ value }: { value: unknown }) {
  return (
    <details className="mx-4 mb-24 rounded-xl bg-stone-800 p-3 text-xs text-stone-100">
      <summary className="cursor-pointer text-stone-300">Request this would send</summary>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function UnitToggle({ value, onChange }: { value: Unit; onChange: (u: Unit) => void }) {
  return (
    <div role="radiogroup" aria-label="Unit" className="flex rounded-xl border border-stone-300 bg-white p-1">
      {(["g", "count"] as Unit[]).map((u) => (
        <button
          key={u}
          role="radio"
          aria-checked={value === u}
          onClick={() => onChange(u)}
          className={`rounded-lg px-3 py-2 ${value === u ? "bg-stone-900 text-white" : "text-stone-600"}`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-stone-600">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  "rounded-xl border border-stone-300 bg-white px-3 py-3 outline-none focus:ring-2 focus:ring-emerald-500";

export function Stepper(props: { label: string; value: number; step: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-sm font-medium text-stone-600">{props.label}</span>
      <div className="flex items-center gap-3">
        <button
          aria-label={`${props.label} minus ${props.step}`}
          onClick={() => props.onChange(Math.max(0, props.value - props.step))}
          className="h-14 w-14 rounded-full bg-stone-200 text-2xl active:bg-stone-300"
        >
          -
        </button>
        <input
          aria-label={props.label}
          inputMode="decimal"
          value={props.value}
          onChange={(e) => props.onChange(Number(e.target.value) || 0)}
          className="w-24 bg-transparent text-center text-4xl font-semibold outline-none"
        />
        <button
          aria-label={`${props.label} plus ${props.step}`}
          onClick={() => props.onChange(props.value + props.step)}
          className="h-14 w-14 rounded-full bg-stone-200 text-2xl active:bg-stone-300"
        >
          +
        </button>
      </div>
      {props.suffix && <span className="text-stone-500">{props.suffix}</span>}
    </div>
  );
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div role="status" className="fixed top-3 left-1/2 z-40 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-white shadow">
      {text}
    </div>
  );
}

export function fmtSet(w: number | null, reps: number) {
  return `${w === null ? "BW" : `${w} lb`} × ${reps}`;
}
