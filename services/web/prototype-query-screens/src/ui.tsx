// PROTOTYPE, throwaway (issue #32). Read-only cards shared by the variants (same look as ADR 0008's feed).
import type { ReactNode } from "react";
import { fmtSet, type Meal, type Session } from "./data";

export function SessionCard({ s, onName, hi }: { s: Session; onName?: () => void; hi?: boolean }) {
  return (
    <article className={`rounded-2xl bg-white p-3 shadow-sm ${hi ? "ring-2 ring-emerald-400" : ""}`}>
      <h3 className="font-semibold">
        {onName ? (
          <button onClick={onName} className="underline decoration-dotted underline-offset-4">
            {s.exercise}
          </button>
        ) : (
          s.exercise
        )}
      </h3>
      <ol className="mt-1">
        {s.sets.map((x, i) => (
          <li key={x.id} className="flex justify-between border-b border-stone-100 py-1.5 text-stone-700 last:border-0">
            <span>
              <span className="text-stone-400">Set {i + 1}</span> · {fmtSet(x)}
            </span>
            <span className="text-sm text-stone-400">{x.time}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

export function MealCard({ m, hiFood }: { m: Meal; hiFood?: string | null }) {
  return (
    <article className="rounded-2xl bg-white p-3 shadow-sm">
      <div className="flex justify-between">
        <span className="font-semibold">
          Meal {m.n}
          {m.label && <span className="font-normal text-stone-500"> · {m.label}</span>}
        </span>
        <span className="text-stone-500">{m.time}</span>
      </div>
      {m.restaurant ? (
        <p className="text-stone-600">🍽️ {m.restaurant}</p>
      ) : (
        <ul className="mt-1 text-stone-600">
          {m.foods.map((f) => (
            <li key={f.name} className={f.name === hiFood ? "rounded bg-emerald-100 px-1 font-medium" : ""}>
              {f.name}{" "}
              <span className="text-stone-400">
                {f.qty} {f.unit}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-20 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-h-[80vh] max-w-md flex-col rounded-t-3xl bg-stone-50 shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="px-2 text-stone-400">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-20">{children}</div>
      </div>
    </>
  );
}

// Last-N-Sessions progression table, used wherever an Exercise is inspected.
export function Progression({ sessions }: { sessions: Session[] }) {
  return (
    <table className="w-full text-left">
      <thead className="text-sm text-stone-500">
        <tr>
          <th className="py-1">Day</th>
          <th>Sets</th>
          <th>Top</th>
          <th className="text-right">Volume</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const top = s.sets.reduce((a, b) => ((b.weight_lb ?? 0) > (a.weight_lb ?? 0) ? b : a));
          const vol = s.sets.reduce((a, x) => a + (x.weight_lb ?? 0) * x.reps, 0);
          return (
            <tr key={s.day} className="border-t border-stone-200">
              <td className="py-1.5">{s.day.slice(5)}</td>
              <td>{s.sets.length}</td>
              <td>{fmtSet(top)}</td>
              <td className="text-right">{vol ? vol.toLocaleString() : "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const chip = (on: boolean) =>
  `whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${on ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-700"}`;
