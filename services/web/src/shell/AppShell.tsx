import { useState, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router";

import { TABS, tabOf, type Tab } from "./tabs";

const ICONS: Record<Tab, ReactNode> = {
  // A clock: what already happened.
  history: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // A house: where the app opens, and where today is logged.
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

type Memory = Record<Tab, string>;

const ROOTS = Object.fromEntries(
  TABS.map(({ id, root }) => [id, root]),
) as Memory;

// Every screen of an approved User renders inside this frame (ADR 0031), Not Found
// included. The Pending screen replaces the whole route tree, so it never gets here.
export function AppShell() {
  const { pathname, search } = useLocation();
  const here = `${pathname}${search}`;
  const active = tabOf(pathname);

  // Each tab's last place, so leaving Home on a past Day and coming back returns to
  // it. React state, not storage: a fresh launch opens every tab at its root.
  const [memory, setMemory] = useState<Memory>(ROOTS);
  // Set while rendering, React's pattern for state that follows the URL: an effect
  // would commit once with the old value and then render again. The guard stops
  // the loop.
  if (active !== null && memory[active] !== here) {
    setMemory({ ...memory, [active]: here });
  }

  return (
    // At least one screen tall, so on a short page the bar still sits at the bottom.
    <div className="flex min-h-dvh flex-col">
      {/* A block, not a flex item, so each screen lays itself out as before. */}
      <div className="flex-1">
        <Outlet />
      </div>
      {/* Sticky, not fixed: it keeps its place in the page, so the end of the page
          scrolls clear of it with no padding that guesses its height. The strip is
          full width but lets taps through; only the pill takes them. z-40 sits under
          Sheet's z-50, so sheets and dialogs cover the bar. */}
      <div className="pointer-events-none sticky bottom-0 z-40 flex justify-center pb-(--tab-bar-lift)">
        <nav
          aria-label="Tabs"
          className="pointer-events-auto flex h-(--tab-bar-height) gap-1 rounded-full bg-card p-1 shadow-lg ring-1 ring-ink/10"
        >
          {TABS.map(({ id, label, root }) => {
            const isActive = id === active;
            return (
              <Link
                key={id}
                // Tapping the tab you are on resets it to its root.
                to={isActive ? root : memory[id]}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-20 flex-col items-center justify-center gap-0.5 rounded-full px-3 py-1.5 text-xs ${
                  isActive
                    ? "bg-action-soft font-semibold text-on-inset"
                    : "text-faint"
                }`}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICONS[id]}
                </svg>
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
