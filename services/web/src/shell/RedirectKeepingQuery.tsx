import { Navigate, useLocation } from "react-router";

// An old URL is a contract: bookmarks and the home-screen shortcut still use it
// (ADR 0031). `<Navigate>` alone drops the query string, and with it every choice
// Search and Dashboards keep there (ADR 0013, ADR 0024). Replace, so Back skips
// the old URL instead of bouncing off it.
export function RedirectKeepingQuery({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}
