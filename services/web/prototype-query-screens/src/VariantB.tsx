// PROTOTYPE, throwaway (issue #32).
// Variant B, "History tab": a third bottom tab. Log (today's feed, unchanged) | History (newest-first list of Days,
// each a one-line summary that expands in place). A filter bar on top (Food or Exercise) plus a range segmented control
// (7 / 14 / 30 days) prunes the list to matching Days; an Exercise filter pins a progression table above the list.
import { useState } from "react";
import { EXERCISES, FOOD_NAMES, TODAY, daysBack, fmtDay, hasFood, lastSessions, mealsOn, sessionsOn } from "./data";
import { MealCard, Progression, SessionCard, chip } from "./ui";

export function VariantB() {
  const [tab, setTab] = useState<"log" | "history">("history");
  const [range, setRange] = useState(14);
  const [filter, setFilter] = useState<{ kind: "food" | "exercise"; name: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const rows = daysBack(range)
    .map((day) => {
      const ss = sessionsOn(day);
      const ms = mealsOn(day);
      const sMatch = filter?.kind === "exercise" ? ss.filter((s) => s.exercise === filter.name) : filter ? [] : ss;
      const mMatch = filter?.kind === "food" ? ms.filter((m) => hasFood(m, filter.name)) : filter ? [] : ms;
      return { day, ss, ms, sMatch, mMatch };
    })
    .filter((r) => !filter || r.sMatch.length || r.mMatch.length);

  return (
    <div className="mx-auto min-h-screen max-w-md pb-40">
      <header className="sticky top-0 z-10 bg-stone-100/95 px-4 pt-4 pb-3 backdrop-blur">
        <h1 className="text-2xl font-bold">{tab === "log" ? "Today" : "History"}</h1>
        {tab === "history" && (
          <>
            <div className="mt-2 flex gap-2">
              {[7, 14, 30].map((n) => (
                <button key={n} onClick={() => setRange(n)} className={chip(range === n)}>Last {n} days</button>
              ))}
            </div>
            <select
              value={filter ? `${filter.kind}:${filter.name}` : ""}
              onChange={(e) => {
                const [kind, ...rest] = e.target.value.split(":");
                setFilter(e.target.value ? { kind: kind as "food" | "exercise", name: rest.join(":") } : null);
              }}
              className="mt-2 w-full rounded-xl border border-stone-300 bg-white px-3 py-2"
            >
              <option value="">Everything</option>
              <optgroup label="Exercise">{EXERCISES.map((n) => <option key={n} value={`exercise:${n}`}>{n}</option>)}</optgroup>
              <optgroup label="Food">{FOOD_NAMES.map((n) => <option key={n} value={`food:${n}`}>{n}</option>)}</optgroup>
            </select>
          </>
        )}
      </header>

      {tab === "log" ? (
        <section className="flex flex-col gap-3 px-4">
          <p className="text-sm text-stone-500">(The two ADR 0008 windows, unchanged: today only.)</p>
          {sessionsOn(TODAY).map((s) => <SessionCard key={s.exercise} s={s} />)}
          {mealsOn(TODAY).map((m) => <MealCard key={m.id} m={m} />)}
        </section>
      ) : (
        <section className="flex flex-col gap-2 px-4">
          {filter?.kind === "exercise" && (
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <h2 className="mb-1 font-semibold">{filter.name}: last 5 Sessions</h2>
              <Progression sessions={lastSessions(filter.name, 5)} />
            </div>
          )}
          {rows.length === 0 && <p className="text-stone-400">Nothing matches in the last {range} days</p>}
          {rows.map((r) => (
            <div key={r.day} className="rounded-2xl bg-white shadow-sm">
              <button onClick={() => setOpen(open === r.day ? null : r.day)} className="flex w-full items-center justify-between p-3 text-left">
                <span>
                  <span className="block font-semibold">{fmtDay(r.day)}</span>
                  <span className="text-sm text-stone-500">
                    {filter
                      ? `${r.sMatch.reduce((a, s) => a + s.sets.length, 0) || ""}${r.sMatch.length ? " sets" : ""}${r.mMatch.length ? `${r.mMatch.length} meal(s)` : ""}`
                      : `${r.ss.length} exercises · ${r.ss.reduce((a, s) => a + s.sets.length, 0)} sets · ${r.ms.length} meals`}
                  </span>
                </span>
                <span className="text-stone-400">{open === r.day ? "▴" : "▾"}</span>
              </button>
              {open === r.day && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                  {(filter ? r.sMatch : r.ss).map((s) => <SessionCard key={s.exercise} s={s} />)}
                  {(filter ? r.mMatch : r.ms).map((m) => <MealCard key={m.id} m={m} hiFood={filter?.kind === "food" ? filter.name : null} />)}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <nav className="fixed inset-x-0 bottom-14 z-10 mx-auto grid max-w-md grid-cols-2 border-t border-stone-300 bg-white">
        {(["log", "history"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`py-3 capitalize ${tab === t ? "font-semibold text-emerald-700" : "text-stone-500"}`}>{t}</button>
        ))}
      </nav>
    </div>
  );
}
