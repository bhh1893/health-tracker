import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { shouldRetry } from "./query-client";

const failure = (status: number) =>
  new ApiError({ type: "about:blank", title: "Failed", status });

describe("shouldRetry", () => {
  it("does not retry a 4xx", () => {
    expect(shouldRetry(0, failure(401))).toBe(false);
    expect(shouldRetry(0, failure(422))).toBe(false);
  });

  it("retries a 5xx and a network failure, up to the limit", () => {
    expect(shouldRetry(0, failure(503))).toBe(true);
    expect(shouldRetry(1, new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetry(2, failure(503))).toBe(false);
  });
});
