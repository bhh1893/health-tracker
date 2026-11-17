import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client";
import { ProblemAlert } from "./ProblemAlert";

describe("ProblemAlert", () => {
  it("shows a rate-limited User what to do", () => {
    const error = new ApiError({
      type: "urn:health-tracker:problem:rate-limited",
      title: "Too Many Requests",
      status: 429,
      detail: "Too many requests. Wait a moment and try again.",
    });

    render(<ProblemAlert error={error} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Too many requests. Wait a moment and try again.",
    );
  });
});
