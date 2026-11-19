import type { components } from "../api/schema";

export type DayTotal = components["schemas"]["DayTotal"];
export type MealTotal = components["schemas"]["MealTotal"];

// What a Meal's total holds before the server has worked it out: nothing counted yet.
// Only the server knows a Food's Nutrition, so an optimistic Meal cannot do better.
export const UNKNOWN_TOTAL: MealTotal = {
  kcal: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  incomplete: true,
};

const WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// Whole numbers: a label's own rounding is coarser than a decimal place would claim.
// Shown as "cal", the everyday word; the data stays in kcal, the same quantity.
export const formatKcal = (kcal: number) => `${WHOLE.format(kcal)} cal`;

interface Macros {
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

// "P 19 g · C 72 g · F 11 g", or null on a Restaurant Day, whose macros are unknown
// rather than zero (ADR 0023).
export function formatMacros({ protein_g, carbs_g, fat_g }: Macros) {
  if (protein_g === null || carbs_g === null || fat_g === null) {
    return null;
  }
  const grams = (value: number) => `${WHOLE.format(value)} g`;
  return `P ${grams(protein_g)} · C ${grams(carbs_g)} · F ${grams(fat_g)}`;
}
