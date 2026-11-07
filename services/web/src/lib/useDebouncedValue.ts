import { useEffect, useState } from "react";

// The value, once it has stopped changing for `delay` ms.
export function useDebouncedValue<T>(value: T, delay: number) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return settled;
}
