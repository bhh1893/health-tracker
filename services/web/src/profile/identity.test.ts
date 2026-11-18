import { describe, expect, it } from "vitest";

import { avatarLetter } from "./identity";

describe("avatarLetter", () => {
  it("takes the first letter of the name, uppercased", () => {
    expect(avatarLetter("bao", "owner@example.test")).toBe("B");
  });

  it("falls back to the email when the name is missing", () => {
    expect(avatarLetter(null, "owner@example.test")).toBe("O");
  });

  it("falls back to the email when the name is blank", () => {
    expect(avatarLetter("  ", "owner@example.test")).toBe("O");
  });

  it("gives no letter when both are missing, so the icon shows", () => {
    expect(avatarLetter(null, null)).toBeNull();
  });

  it("keeps a character outside the Basic Multilingual Plane whole", () => {
    expect(avatarLetter("𝒜lice", null)).toBe("𝒜");
  });
});
