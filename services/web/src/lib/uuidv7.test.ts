import { describe, expect, it, vi } from "vitest";

import { uuidv7 } from "./uuidv7";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fillRandomWith(value: number) {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    new Uint8Array(array.buffer).fill(value);
    return array;
  });
}

describe("uuidv7", () => {
  it("has the UUIDv7 shape", () => {
    expect(uuidv7()).toMatch(UUID_V7);
  });

  it("encodes the timestamp in the first 48 bits", () => {
    // The worked example in RFC 9562 appendix A.6.
    expect(uuidv7(0x017f22e279b0).replaceAll("-", "").slice(0, 12)).toBe(
      "017f22e279b0",
    );
  });

  it("keeps a timestamp too large for 32-bit operators", () => {
    const year2100 = Date.UTC(2100, 0, 1);
    const prefix = uuidv7(year2100).replaceAll("-", "").slice(0, 12);
    expect(parseInt(prefix, 16)).toBe(year2100);
  });

  it.each([
    ["all zeros", 0x00, "00000000-0000-7000-8000-000000000000"],
    ["all ones", 0xff, "00000000-0000-7fff-bfff-ffffffffffff"],
  ])("forces version and variant over %s", (_name, fill, expected) => {
    fillRandomWith(fill);
    expect(uuidv7(0)).toBe(expected);
  });

  it("sorts by creation time", () => {
    const ids = [3000, 1000, 2000].map((ms) => uuidv7(ms));
    expect(ids.toSorted()).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("does not repeat within one millisecond", () => {
    const ids = Array.from({ length: 1000 }, () => uuidv7(1000));
    expect(new Set(ids).size).toBe(1000);
  });

  it("works where crypto.randomUUID does not exist", () => {
    // What the phone sees on http://: getRandomValues only.
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
    expect(uuidv7()).toMatch(UUID_V7);
  });
});
