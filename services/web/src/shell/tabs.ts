// The bottom bar's three tabs (ADR 0031). The route is the contract and stays put;
// the label is provisional, so renaming History is a change to this one constant.
export const HISTORY_LABEL = "History";

export type Tab = "history" | "add" | "profile";

export interface TabSpec {
  id: Tab;
  label: string;
  // Where the tab opens on a fresh launch, and where tapping it again resets to.
  root: string;
}

export const TABS: readonly TabSpec[] = [
  { id: "history", label: HISTORY_LABEL, root: "/history" },
  // Add's root has no ?day=, so a reset lands on today.
  { id: "add", label: "Add", root: "/meals" },
  { id: "profile", label: "Profile", root: "/profile" },
];

function under(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

// Which tab owns a path, or null for one no tab owns (Not Found): the bar shows on
// it with no tab active, and it is not remembered as any tab's last place.
export function tabOf(pathname: string): Tab | null {
  if (under(pathname, "/history")) {
    return "history";
  }
  if (under(pathname, "/exercise") || under(pathname, "/meals")) {
    return "add";
  }
  if (under(pathname, "/profile")) {
    return "profile";
  }
  return null;
}
