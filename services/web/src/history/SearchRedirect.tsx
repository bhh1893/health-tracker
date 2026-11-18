import { Navigate, useLocation } from "react-router";

import { fromOldSearch, toHistoryParams } from "./historyQuery";

// Search is gone, but its URLs are a contract (ADR 0031): bookmarks and shared
// links still open the same Exercise or Food, now on History (ADR 0033). Replace,
// so Back skips the old URL instead of bouncing off it.
export function SearchRedirect() {
  const { search } = useLocation();
  const params = toHistoryParams(fromOldSearch(new URLSearchParams(search)));
  return (
    <Navigate
      to={{ pathname: "/history", search: params.toString() }}
      replace
    />
  );
}
