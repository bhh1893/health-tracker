import { Fragment, type ReactNode } from "react";

import type { RestaurantRef } from "../catalog/catalogs";
import { DEFAULT_CATEGORY, categoryName } from "../catalog/restaurantCategory";
import { CategoryIcon } from "../components/CategoryIcon";

interface RestaurantLineProps {
  restaurants: RestaurantRef[];
  // How each name is drawn: History marks the filter's matches in it.
  renderName?: (name: string) => ReactNode;
  className?: string;
}

// A Restaurant Meal's Restaurants in pink, in the order they were added, wrapping
// onto more lines as needed (ADR 0034). Each name follows its Category's icon (ADR
// 0041), so a night of dinner then drinks shows both. The names are one run of
// text, so a long list wraps like a sentence instead of overflowing.
export function RestaurantLine({
  restaurants,
  renderName = (name) => name,
  className = "",
}: RestaurantLineProps) {
  return (
    // min-w-0 lets a name with no spaces break instead of pushing past the edge.
    <li className={`min-w-0 wrap-break-word text-restaurant-ink ${className}`}>
      {restaurants.map((restaurant, index) => (
        <Fragment key={restaurant.id}>
          {index > 0 && " · "}
          {/* The icon is hidden from screen readers. They hear the Category
              after the name instead, but only drinks or dessert: almost every
              Restaurant is ate out, and "(ate out)" after each would be noise. */}
          <span className="mr-1 inline-block align-[-2px]">
            <CategoryIcon category={restaurant.category} />
          </span>
          {renderName(restaurant.name)}
          {restaurant.category !== DEFAULT_CATEGORY && (
            <span className="sr-only">
              {" "}
              ({categoryName(restaurant.category)})
            </span>
          )}
        </Fragment>
      ))}
    </li>
  );
}
