import { useLocation } from "react-router";

export function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <output aria-label="url">{`${pathname}${search}`}</output>;
}
