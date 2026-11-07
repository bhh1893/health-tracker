import { useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";

import { resolveViewedDay, toDay } from "./day";

const DAY_PARAM = "day";

function subscribeToReturn(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
  };
}

const currentDay = () => toDay(new Date());

// A home-screen app sits suspended overnight and resumes without reloading. Reading
// the date again on return stops this morning's Sets from landing on yesterday.
function useToday() {
  return useSyncExternalStore(subscribeToReturn, currentDay);
}

// The viewed Day lives in the URL, not component state, so reload, the back
// button and links from Search all keep it (ADR 0013). No param means Today.
export function useViewedDay() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useToday();
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

  return { day, today, isToday: day === today, setDay };
}
