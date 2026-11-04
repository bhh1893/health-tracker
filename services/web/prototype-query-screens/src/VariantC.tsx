// PROTOTYPE, throwaway (issue #32).
// Variant C, "Ask screen": a sentence-shaped query builder. "Show [Exercise|Food|Everything] [name] for [range]".
// Results are grouped by Day; an Exercise query can flip to "Last N Sessions" mode (progression, ignores the range).
import { useState } from "react";
import { EXERCISES, FOOD_NAMES, TODAY, dayOffset, daysBack, fmtDay, hasFood, lastSessions, mealsOn, sessionsOn } from "./data";
import { MealCard, Progression, SessionCard, chip } from "./ui";

type What = "everything" | "exercise" | "food";
const RANGES = [
  { key: "today", label: "Today", n: 1 },
  { key: "yest", label: "Yesterday", n: 0 },
  { key: "7", label: "7 days", n: 7 },
  { key: "30", label: "30 days", n: 30 },
  { key: "custom", label: "Custom", n: 0 },
];

export function VariantC() {
  const [what, setWhat] = useState<What>("exercise");
  const [name, setName] = useState("Bench press");
  const [range, setRange] = useState("7");
  const [from, setFrom] = useState(dayOffset(10));
  const [to, setTo] = useState(TODAY);
  const [lastN, setLastN] = useState<number | null>(null);

  const pickWhat = (w: What) => { setWhat(w); setName(w === "exercise" ? EXERCISES[0] : w === "food" ? FOOD_NAMES[0] : ""); setLastN(null); };
  const days =
    range === "yest" ? [dayOffset(1)]
    : range === "custom" ? daysBack(60).filter((d) => d >= from && d <= to)
    : daysBack(RANGES.find((r) => r.key === range)!.n);

  const results = days
    .map((day) => ({
      day,
      ss: what === "food" ? [] : sessionsOn(day).filter((s) => what === "everything" || s.exercise === name),
      ms: what === "exercise" ? [] : mealsOn(day).filter((m) => what === "everything" || hasFood(m, name)),
    }))
    .filter((r) => r.ss.length || r.ms.length);

  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pt-4 pb-40">
      <h1 className="mb-3 text-2xl font-bold">Look something up</h1>
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex gap-2">
          {(["exercise", "food", "everything"] as const).map((w) => (
            <button key={w} onClick={() => pickWhat(w)} className={`${chip(what === w)} capitalize`}>{w}</button>
          ))}
        </div>
        {what !== "everything" && (
          <select value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl border border-stone-300 px-3 py-2">
            {(what === "exercise" ? EXERCISES : FOOD_NAMES).map((n) => <option key={n}>{n}</option>)}
          </select>
        )}
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => { setRange(r.key); setLastN(null); }} className={chip(!lastN && range === r.key)}>{r.label}</button>
          ))}
          {what === "exercise" && (
            <button onClick={() => setLastN(lastN ?? 5)} className={chip(!!lastN)}>Last N Sessions</button>
          )}
        </div>
        {range === "custom" && !lastN && (
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="flex-1 rounded-xl border border-stone-300 px-2 py-2" />
            <span>to</span>
            <input type="date" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value)} className="flex-1 rounded-xl border border-stone-300 px-2 py-2" />
          </div>
        )}
        {lastN && (
          <div className="flex items-center gap-3">
            <span>Last</span>
            <button onClick={() => setLastN(Math.max(1, lastN - 1))} className="h-10 w-10 rounded-full bg-stone-200">-</button>
            <b>{lastN}</b>
            <button onClick={() => setLastN(lastN + 1)} className="h-10 w-10 rounded-full bg-stone-200">+</button>
            <span>Sessions</span>
          </div>
        )}
      </div>

      <section className="mt-4 flex flex-col gap-3">
        {lastN ? (
          <div className="rounded-2xl bg-white p-3 shadow-sm">
            <Progression sessions={lastSessions(name, lastN)} />
          </div>
        ) : (
          <>
            <p className="text-sm text-stone-500">{results.length} Day(s) match</p>
            {results.map((r) => (
              <div key={r.day} className="flex flex-col gap-2">
                <h2 className="mt-1 font-semibold text-stone-600">{fmtDay(r.day)}</h2>
                {r.ss.map((s) => <SessionCard key={s.exercise} s={s} hi={what === "exercise"} />)}
                {r.ms.map((m) => <MealCard key={m.id} m={m} hiFood={what === "food" ? name : null} />)}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
