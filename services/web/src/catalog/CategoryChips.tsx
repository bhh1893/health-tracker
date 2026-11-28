import { ToggleButton } from "react-aria-components";

import { chipClass } from "../components/formStyles";
import { CATEGORIES, type RestaurantCategory } from "./restaurantCategory";

interface CategoryChipsProps {
  value: RestaurantCategory | null;
  onChange: (category: RestaurantCategory | null) => void;
}

// Ate out | Drinks | Dessert as filter chips (ADR 0041): one Category at a time, or
// none, since tapping the chosen chip clears it. Fragments, so each chip sits in
// whatever row of chips holds them.
export function CategoryChips({ value, onChange }: CategoryChipsProps) {
  return CATEGORIES.map(({ id, label }) => (
    <ToggleButton
      key={id}
      className={chipClass}
      isSelected={value === id}
      onChange={(selected) => {
        onChange(selected ? id : null);
      }}
    >
      {label}
    </ToggleButton>
  ));
}
