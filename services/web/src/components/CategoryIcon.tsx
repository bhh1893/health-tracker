import type { ReactNode } from "react";

import type { RestaurantCategory } from "../catalog/restaurantCategory";
import { ForkKnifeIcon } from "./ForkKnifeIcon";

// Drawn like ForkKnifeIcon: a 24-unit line drawing in currentColor, hidden from
// screen readers, which hear the Category's name from the text beside it.
function LineIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// One icon per Restaurant Category (ADR 0041): the fork and knife for ate out, a
// cocktail glass for drinks, a cone for dessert.
export function CategoryIcon({ category }: { category: RestaurantCategory }) {
  switch (category) {
    case "ate_out":
      return <ForkKnifeIcon />;
    case "drinks":
      return (
        <LineIcon>
          <path d="M5 4h14l-7 8zM12 12v8M8 20h8" />
        </LineIcon>
      );
    case "dessert":
      return (
        <LineIcon>
          <circle cx="12" cy="8" r="4" />
          <path d="M8.5 10 12 21l3.5-11" />
        </LineIcon>
      );
  }
}
