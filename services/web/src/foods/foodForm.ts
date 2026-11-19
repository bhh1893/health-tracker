import type { components } from "../api/schema";
import { MAX_NAME_LENGTH } from "../catalog/catalogs";

export type Food = components["schemas"]["Food"];
export type Nutrition = components["schemas"]["Nutrition"];
export type PatchFood = components["schemas"]["PatchFood"];
export type PutFood = components["schemas"]["PutFood"];
export type ReferenceFood = components["schemas"]["ReferenceFood"];

// The server's bounds (ADR 0023, services/api catalogs.py), mirrored so the form
// refuses what the API would, and says so in the form's own words before any request.
export const MIN_BASIS_G = 0.001;
export const MAX_GRAMS = 1_000_000;
export const MAX_KCAL = 10_000;

export const NUTRITION_FIELDS = [
  "basis_g",
  "kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
] as const;
export type NutritionField = (typeof NUTRITION_FIELDS)[number];
export type FoodField = "name" | NutritionField | "piece_g" | "nutrition";

// The Food as the sheet edits it. Each number is the input's text, as for a Food
// Entry's quantity: "", "1." and "0" are all things a user passes through.
export type FoodDraft = { name: string; piece_g: string } & Record<
  NutritionField,
  string
>;

const text = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

// The Add sheet on Profile's Foods page starts here (ADR 0032).
export const EMPTY_FOOD_DRAFT: FoodDraft = {
  name: "",
  basis_g: "",
  kcal: "",
  protein_g: "",
  carbs_g: "",
  fat_g: "",
  piece_g: "",
};

export function draftOf(food: Food): FoodDraft {
  const nutrition = food.nutrition ?? null;
  return {
    name: food.name,
    basis_g: text(nutrition?.basis_g),
    kcal: text(nutrition?.kcal),
    protein_g: text(nutrition?.protein_g),
    carbs_g: text(nutrition?.carbs_g),
    fat_g: text(nutrition?.fat_g),
    piece_g: text(food.piece_g),
  };
}

// Copy-on-pick (ADR 0023): the Reference Food's values overwrite the form's, and
// nothing points back at it. The name stays the User's own. A Reference Food without
// a Piece Weight leaves the form's alone: it has nothing to say about one piece.
export function fillFrom(
  draft: FoodDraft,
  reference: ReferenceFood,
): FoodDraft {
  const { nutrition, piece_g } = reference;
  return {
    ...draft,
    basis_g: String(nutrition.basis_g),
    kcal: String(nutrition.kcal),
    protein_g: String(nutrition.protein_g),
    carbs_g: String(nutrition.carbs_g),
    fat_g: String(nutrition.fat_g),
    piece_g:
      piece_g === null || piece_g === undefined
        ? draft.piece_g
        : String(piece_g),
  };
}

// A number the user finished typing, or null for anything else ("", "1e", "abc").
function parse(value: string) {
  if (value.trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export type FoodErrors = Partial<Record<FoodField, string>>;

export type FoodCheck =
  { ok: true; body: PutFood } | { ok: false; errors: FoodErrors };

function checkNutrition(
  draft: FoodDraft,
  errors: FoodErrors,
): Nutrition | null {
  const filled = NUTRITION_FIELDS.filter((field) => draft[field].trim() !== "");
  if (filled.length === 0) {
    return null;
  }
  // All or none, as the CHECK on `foods` has it: a partial label would make a
  // Day total that looks real but counts only some of the Food.
  if (filled.length < NUTRITION_FIELDS.length) {
    errors.nutrition = "Fill in all five, or clear them all.";
  }
  const basis = parse(draft.basis_g);
  const kcal = parse(draft.kcal);
  const protein = parse(draft.protein_g);
  const carbs = parse(draft.carbs_g);
  const fat = parse(draft.fat_g);
  if (draft.basis_g.trim() !== "") {
    if (basis === null || basis < MIN_BASIS_G || basis > MAX_GRAMS) {
      errors.basis_g = `Between ${String(MIN_BASIS_G)} and ${MAX_GRAMS.toLocaleString("en-US")} g.`;
    }
  }
  if (draft.kcal.trim() !== "") {
    if (kcal === null || kcal < 0 || kcal > MAX_KCAL) {
      errors.kcal = `Between 0 and ${MAX_KCAL.toLocaleString("en-US")}.`;
    }
  }
  const macros = [
    ["protein_g", protein],
    ["carbs_g", carbs],
    ["fat_g", fat],
  ] as const;
  for (const [field, value] of macros) {
    if (draft[field].trim() === "") {
      continue;
    }
    if (value === null || value < 0) {
      errors[field] = "0 or more.";
    } else if (
      basis !== null &&
      errors.basis_g === undefined &&
      value > basis
    ) {
      // Each macro on its own, as the server checks it: 60 g of food cannot hold
      // 70 g of protein.
      errors[field] = "No more than the Basis.";
    }
  }
  if (
    basis === null ||
    kcal === null ||
    protein === null ||
    carbs === null ||
    fat === null
  ) {
    return null;
  }
  return {
    basis_g: basis,
    kcal,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
  };
}

// The one write the Save button sends, or why the form cannot send it yet: a PATCH
// for a Food that exists, a PUT for a new one. It always names all three fields: the
// form shows the whole Food, so saving it means "the Food is now what is on screen",
// and an empty block or Piece Weight clears it.
export function checkFood(draft: FoodDraft): FoodCheck {
  const errors: FoodErrors = {};

  const name = draft.name.trim();
  if (name === "") {
    errors.name = "A Food needs a name.";
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `At most ${String(MAX_NAME_LENGTH)} characters.`;
  }

  const nutrition = checkNutrition(draft, errors);

  const piece = parse(draft.piece_g);
  if (draft.piece_g.trim() !== "") {
    if (piece === null || piece <= 0 || piece > MAX_GRAMS) {
      errors.piece_g = `More than 0, up to ${MAX_GRAMS.toLocaleString("en-US")} g.`;
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    body: { name, nutrition, piece_g: piece, allow_similar: false },
  };
}
