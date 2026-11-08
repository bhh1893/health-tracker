import { useSyncExternalStore } from "react";

import { toDay } from "./day";

function subscribeToReturn(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => {
    document.removeEventListener("visibilitychange", onChange);
  };
}

const currentDay = () => toDay(new Date());

// A home-screen app sits suspended overnight and resumes without reloading. Reading
// the date again on return stops this morning's Sets from landing on yesterday.
export function useToday() {
  return useSyncExternalStore(subscribeToReturn, currentDay);
}
