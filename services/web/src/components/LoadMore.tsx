import { useEffect, useEffectEvent, useRef } from "react";
import { Button } from "react-aria-components";

// How far below the screen the end of a list may still be when the next page is
// asked for, so it has usually arrived by the time the thumb gets there.
const AHEAD = "0px 0px 400px 0px";

interface LoadMoreProps {
  onShow: () => void;
  className: string;
}

// Sits after the last row of a paged list. When it nears the screen, more rows
// load. It is a real button too, for a keyboard or a browser without
// IntersectionObserver.
export function LoadMore({ onShow, className }: LoadMoreProps) {
  const ref = useRef<HTMLButtonElement>(null);
  // Always calls the latest onShow, without re-observing on every render.
  const show = useEffectEvent(onShow);

  useEffect(() => {
    const button = ref.current;
    if (button === null || !("IntersectionObserver" in window)) {
      return;
    }
    // Observing reports the current state at once, so a list still too short to
    // fill the screen keeps loading: the caller unmounts this while a page is in
    // flight, and it remounts after every load.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          show();
        }
      },
      { rootMargin: AHEAD },
    );
    observer.observe(button);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <Button ref={ref} className={className} onPress={onShow}>
      Load more
    </Button>
  );
}
