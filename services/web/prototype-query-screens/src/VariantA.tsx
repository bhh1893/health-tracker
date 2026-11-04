// PROTOTYPE, throwaway (issue #32).
// Variant A, "Day pager in the existing windows": no new screens. The two ADR 0008 windows get a
// ‹ date › pager (native date picker on tap), one filter select, and tapping an Exercise name opens its last 5 Sessions.
// Deliberately has NO date-range view: tests whether single-Day browsing + filter is enough.
import { useState } from "react";
import { FOOD_NAMES, EXERCISES, TODAY, fmtDay, hasFood, lastSessions, mealsOn, sessionsOn, shiftDay } from "./data";
import { MealCard, Progression, SessionCard, Sheet } from "./ui";

export function VariantA() {
  const [win, setWin] = useState<"exercise" | "meals">("exercise");
  const [day, setDay] = useState(TODAY);
  const [filter, setFilter] = useState("");
  const [hist, setHist] = useState<string | null>(null);

  const sessions = sessionsOn(day).filter((s) => !filter || s.exercise === filter);
  const meals = mealsOn(day).filter((m) => !filter || hasFood(m, filter));
  const isPast = day !== TODAY;

  return (
    <div className="mx-auto min-h-screen max-w-md pb-40">
      <header className="sticky top-0 z-10 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <button aria-label="Previous Day" onClick={() => setDay(shiftDay(day, -1))} className="h-11 w-11 rounded-full bg-stone-200 text-xl">‹</button>
          <label className="relative text-center">
            <span className="block text-2xl font-bold">{fmtDay(day)}</span>
            <span className="text-xs text-stone-500">tap to pick a date</span>
            <input type="date" value={day} max={TODAY} onChange={(e) => e.target.value && setDay(e.target.value)} className="absolute inset-0 opacity-0" />
          </label>
          <button aria-label="Next Day" disabled={!isPast} onClick={() => setDay(shiftDay(day, 1))} className="h-11 w-11 rounded-full bg-stone-200 text-xl disabled:opacity-30">›</button>
        </div>
        {isPast && (
          <button onClick={() => setDay(TODAY)} className="mb-2 w-full rounded-xl bg-amber-100 py-1.5 text-sm text-amber-800">
            Viewing a past Day · tap to jump to Today
          </button>
        )}
        <div role="tablist" className="grid grid-cols-2 rounded-xl bg-stone-200 p-1">
          {(["exercise", "meals"] as const).map((w) => (
            <button key={w} role="tab" aria-selected={win === w} onClick={() => { setWin(w); setFilter(""); }}
              className={`rounded-lg py-2 capitalize ${win === w ? "bg-white font-semibold shadow" : "text-stone-600"}`}>{w}</button>
          ))}
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2">
          <option value="">{win === "exercise" ? "All exercises" : "All foods"}</option>
          {(win === "exercise" ? EXERCISES : FOOD_NAMES).map((n) => <option key={n}>{n}</option>)}
        </select>
      </header>

      <section className="flex flex-col gap-3 px-4">
        {win === "exercise" ? (
          sessions.length ? sessions.map((s) => <SessionCard key={s.exercise} s={s} onName={() => setHist(s.exercise)} />) : <p className="text-stone-400">No exercise this Day</p>
        ) : meals.length ? (
          meals.map((m) => <MealCard key={m.id} m={m} hiFood={filter} />)
        ) : (
          <p className="text-stone-400">No meals this Day</p>
        )}
      </section>

      <div className="fixed inset-x-0 bottom-16 mx-auto max-w-md px-4">
        <button className="w-full rounded-2xl bg-emerald-600 py-4 text-lg font-semibold text-white shadow-lg">
          {win === "exercise" ? "+ Add Set" : "+ Add Meal"} to {isPast ? fmtDay(day) : "Today"}
        </button>
      </div>

      {hist && (
        <Sheet title={`${hist}: last 5 Sessions`} onClose={() => setHist(null)}>
          <Progression sessions={lastSessions(hist, 5)} />
        </Sheet>
      )}
    </div>
  );
}
