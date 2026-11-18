import { ApiError } from "../api/client";
import type { CatalogRef } from "./catalogs";

// The Problem types a Catalog write answers with when a name is taken (ADR 0008).
export const EXACT_DUPLICATE = "urn:health-tracker:problem:exact-duplicate";
export const NEAR_DUPLICATE = "urn:health-tracker:problem:near-duplicate";

export type NameClash =
  | { kind: "exact"; existing: CatalogRef }
  | { kind: "near"; similar: CatalogRef[] };

// What a failed create or rename says about the name, or null for any other failure.
export function nameClashOf(error: unknown): NameClash | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  const { type, existing, similar } = error.problem;
  if (type === EXACT_DUPLICATE && existing) {
    return { kind: "exact", existing };
  }
  if (type === NEAR_DUPLICATE && similar) {
    return { kind: "near", similar };
  }
  return null;
}
