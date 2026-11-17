import { NavLink, Outlet, useLocation } from "react-router";

const segmentClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 rounded-lg px-4 py-2 text-center text-base ${
    isActive ? "bg-white font-semibold shadow-sm" : "text-gray-600"
  }`;

// Exercise and Meals share this frame (ADR 0008): the Add tab's screen. Search and
// Dashboards are reached from the bottom bar's History tab (ADR 0031).
export function WindowLayout() {
  // Keeps ?day= when switching windows, so both show the same Day.
  const { search } = useLocation();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Health Tracker</h1>
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
      <Outlet />
    </div>
  );
}
