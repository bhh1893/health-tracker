import { Fragment, type ReactNode } from "react";

import type { CatalogRef } from "../catalog/catalogs";
import { ForkKnifeIcon } from "../components/ForkKnifeIcon";

interface RestaurantLineProps {
  restaurants: CatalogRef[];
  // How each name is drawn: History marks the filter's matches in it.
  renderName?: (name: string) => ReactNode;
  className?: string;
}

// A Restaurant Meal's Restaurants in pink with the fork and knife, in the order
// they were added, wrapping onto more lines as needed (ADR 0034). The names are one
// run of text, so a long list wraps like a sentence instead of overflowing.
export function RestaurantLine({
  restaurants,
  renderName = (name) => name,
  className = "",
}: RestaurantLineProps) {
  return (
    <li className={`flex items-start gap-2 text-restaurant-ink ${className}`}>
      {/* As tall as one line of text, so the icon sits beside the first line. */}
      <span className="flex h-6 items-center">
        <ForkKnifeIcon />
      </span>
      <span>
        {restaurants.map((restaurant, index) => (
          <Fragment key={restaurant.id}>
            {index > 0 && " · "}
            {renderName(restaurant.name)}
          </Fragment>
        ))}
      </span>
    </li>
  );
}
