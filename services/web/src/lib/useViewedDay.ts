import { useSearchParams } from "react-router";

import { resolveViewedDay, toDay } from "./day";

const DAY_PARAM = "day";

// The viewed Day lives in the URL, not component state, so reload, the back
// button and links from Search all keep it (ADR 0013). No param means Today.
export function useViewedDay() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = toDay(new Date());
  const day = resolveViewedDay(searchParams.get(DAY_PARAM), today);

  function setDay(next: string) {
    setSearchParams((params) => {
      if (next === today) {
        params.delete(DAY_PARAM);
      } else {
        params.set(DAY_PARAM, next);
      }
      return params;
    });
  }

  return { day, isToday: day === today, setDay };
}
