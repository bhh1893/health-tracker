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
  add: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
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

  // Each tab's last place, so leaving Add on a past Day and coming back returns to
  // it. React state, not storage: a fresh launch opens every tab at its root.
  const [memory, setMemory] = useState<Memory>(ROOTS);
  // Set while rendering, React's pattern for state that follows the URL: an effect
  // would commit once with the old value and then render again. The guard stops
  // the loop.
  if (active !== null && memory[active] !== here) {
    setMemory({ ...memory, [active]: here });
  }

  return (
    // The padding keeps the last card above the bar: the bar's height, its gap from
    // the edge, and the iPhone home indicator's inset.
    <div className="pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <Outlet />
      <nav
        aria-label="Tabs"
        // z-40 sits under BottomSheet's z-50, so sheets and dialogs cover the bar.
        className="fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex w-fit gap-1 rounded-full bg-white p-1 shadow-lg ring-1 ring-black/5"
      >
        {TABS.map(({ id, label, root }) => {
          const isActive = id === active;
          return (
            <Link
              key={id}
              // Tapping the tab you are on resets it to its root.
              to={isActive ? root : memory[id]}
              aria-current={isActive ? "page" : undefined}
              className={`flex w-20 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-xs ${
                isActive
                  ? "bg-teal-50 font-semibold text-teal-700"
                  : "text-gray-500"
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
  );
}
