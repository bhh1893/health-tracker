import { describe, expect, it } from "vitest";

import openapi from "../../../api/openapi.json";
import { MAX_NAME_LENGTH } from "../catalog/catalogs";

import {
  checkFood,
  draftOf,
  fillFrom,
  type Food,
  MAX_GRAMS,
  MAX_KCAL,
  MIN_BASIS_G,
  type FoodDraft,
  type ReferenceFood,
} from "./foodForm";

const bare: Food = {
  id: "0190a000-0000-7000-8000-000000000101",
  name: "Oats",
  archived: false,
  nutrition: null,
  piece_g: null,
};

const empty = draftOf(bare);

const label: FoodDraft = {
  ...empty,
  basis_g: "40",
  kcal: "150",
  protein_g: "5",
  carbs_g: "27",
  fat_g: "3",
};

const rolledOats: ReferenceFood = {
  id: "0190a000-0000-7000-8000-000000000301",
  name: "Rolled oats",
  nutrition: {
    basis_g: 100,
    kcal: 379,
    protein_g: 13,
    carbs_g: 68,
    fat_g: 6.5,
  },
  piece_g: null,
};

describe("draftOf", () => {
  it("shows a Food without Nutrition as empty fields", () => {
    expect(empty).toEqual({
      name: "Oats",
      basis_g: "",
      kcal: "",
      protein_g: "",
      carbs_g: "",
      fat_g: "",
      piece_g: "",
    });
  });

  it("shows stored values as typed, not converted to per 100 g", () => {
    const draft = draftOf({
      ...bare,
      nutrition: {
        basis_g: 60,
        kcal: 250,
        protein_g: 4,
        carbs_g: 40,
        fat_g: 8,
      },
      piece_g: 60,
    });
    expect(draft).toMatchObject({ basis_g: "60", kcal: "250", piece_g: "60" });
  });
});

describe("fillFrom", () => {
  it("copies Nutrition but keeps the User's name", () => {
    const filled = fillFrom(empty, rolledOats);
    expect(filled).toMatchObject({
      name: "Oats",
      basis_g: "100",
      kcal: "379",
      fat_g: "6.5",
    });
  });

  it("keeps the form's Piece Weight when the reference has none", () => {
    expect(fillFrom({ ...empty, piece_g: "30" }, rolledOats).piece_g).toBe(
      "30",
    );
  });

  it("copies the reference's Piece Weight when it has one", () => {
    const banana = { ...rolledOats, piece_g: 118 };
    expect(fillFrom({ ...empty, piece_g: "30" }, banana).piece_g).toBe("118");
  });
});

describe("checkFood", () => {
  it("clears Nutrition and Piece Weight when every field is empty", () => {
    expect(checkFood(empty)).toEqual({
      ok: true,
      body: {
        name: "Oats",
        nutrition: null,
        piece_g: null,
        allow_similar: false,
      },
    });
  });

  it("sends a full label as numbers, with the name trimmed", () => {
    const result = checkFood({ ...label, name: "  Oats ", piece_g: "40" });
    expect(result).toEqual({
      ok: true,
      body: {
        name: "Oats",
        nutrition: {
          basis_g: 40,
          kcal: 150,
          protein_g: 5,
          carbs_g: 27,
          fat_g: 3,
        },
        piece_g: 40,
        allow_similar: false,
      },
    });
  });

  it("refuses a partial Nutrition block, as the server does", () => {
    const result = checkFood({ ...empty, kcal: "150" });
    expect(result).toEqual({
      ok: false,
      errors: { nutrition: "Fill in all five, or clear them all." },
    });
  });

  it("refuses a macro heavier than the Basis", () => {
    const result = checkFood({ ...label, protein_g: "41" });
    expect(result).toMatchObject({
      ok: false,
      errors: { protein_g: "No more than the Basis." },
    });
  });

  it.each([
    ["basis_g", "0"],
    ["basis_g", "0.0009"],
    ["basis_g", "1000001"],
    ["kcal", "-1"],
    ["kcal", "10001"],
    ["fat_g", "-0.5"],
    ["carbs_g", "abc"],
  ] as const)("refuses %s = %j", (field, value) => {
    const result = checkFood({ ...label, [field]: value });
    expect(result.ok).toBe(false);
    expect(result.ok || result.errors[field]).toBeTruthy();
  });

  it.each(["0.001", "1000000"])("accepts a Basis of %j", (value) => {
    const noMacros = { ...label, protein_g: "0", carbs_g: "0", fat_g: "0" };
    expect(checkFood({ ...noMacros, basis_g: value }).ok).toBe(true);
  });

  it.each([
    ["kcal", "0"],
    ["kcal", "10000"],
    ["protein_g", "40"],
  ] as const)("accepts %s = %j at the bound", (field, value) => {
    expect(checkFood({ ...label, [field]: value }).ok).toBe(true);
  });

  it.each(["0", "-1", "1000001"])("refuses Piece Weight %j", (value) => {
    expect(checkFood({ ...empty, piece_g: value })).toMatchObject({
      ok: false,
      errors: { piece_g: expect.any(String) as unknown },
    });
  });

  it("needs a name", () => {
    expect(checkFood({ ...empty, name: "   " })).toEqual({
      ok: false,
      errors: { name: "A Food needs a name." },
    });
  });
});

// The form mirrors the server's rules (ADR 0023). The generated contract carries the
// bounds, so a change on the server fails here instead of drifting from the form.
describe("the mirrored bounds", () => {
  interface Bound {
    minimum?: number;
    exclusiveMinimum?: number;
    maximum?: number;
    maxLength?: number;
  }
  type Property = Bound & { anyOf?: Bound[] };
  const contract = openapi as unknown as {
    components: {
      schemas: Record<string, { properties: Record<string, Property> }>;
    };
  };
  const { Nutrition, PatchFood } = contract.components.schemas;
  // A nullable field's bounds sit in its non-null branch.
  const bounds = (property: Property | undefined): Bound =>
    property?.anyOf?.[0] ?? property ?? {};

  it("matches the contract's Nutrition bounds", () => {
    const fields = Nutrition?.properties ?? {};
    expect(bounds(fields.basis_g)).toMatchObject({
      minimum: MIN_BASIS_G,
      maximum: MAX_GRAMS,
    });
    expect(bounds(fields.kcal)).toMatchObject({
      minimum: 0,
      maximum: MAX_KCAL,
    });
    for (const macro of ["protein_g", "carbs_g", "fat_g"]) {
      expect(bounds(fields[macro])).toMatchObject({ minimum: 0 });
    }
  });

  it("matches the contract's name and Piece Weight bounds", () => {
    const fields = PatchFood?.properties ?? {};
    expect(bounds(fields.name)).toMatchObject({ maxLength: MAX_NAME_LENGTH });
    expect(bounds(fields.piece_g)).toMatchObject({
      exclusiveMinimum: 0,
      maximum: MAX_GRAMS,
    });
  });
});
