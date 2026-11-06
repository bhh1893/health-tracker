import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { api, unwrap } from "../api/client";
import { ProblemAlert } from "../components/ProblemAlert";

const segmentClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 rounded-lg px-4 py-2 text-center text-base ${
    isActive ? "bg-white font-semibold shadow-sm" : "text-gray-600"
  }`;

// Exercise and Meals share this frame (ADR 0008). Search stays one tap away in the
// header, not a third window, so the daily logging screen stays quiet (ADR 0013).
export function WindowLayout() {
  // Keeps ?day= when switching windows, so both show the same Day.
  const { search } = useLocation();

  // One small authenticated call, so a wrong secret fails at load instead of at
  // the first save. A 401 here returns to the secret screen via the API middleware.
  const { error } = useQuery({
    queryKey: ["auth-check"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/exercises", { params: { query: { limit: 1 } } })),
  });

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Health Tracker</h1>
        <Link
          to="/search"
          aria-label="Search"
          className="rounded-lg p-2 text-teal-700"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </Link>
      </header>
      <nav
        aria-label="Windows"
        className="flex gap-1 rounded-xl bg-gray-100 p-1"
      >
        <NavLink
          to={{ pathname: "/exercise", search }}
          className={segmentClass}
        >
          Exercise
        </NavLink>
        <NavLink to={{ pathname: "/meals", search }} className={segmentClass}>
          Meals
        </NavLink>
      </nav>
      {error && <ProblemAlert error={error} />}
      <Outlet />
    </div>
  );
}
