import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Highlight } from "./Highlight";

// What the reader sees, with each <mark> shown as [brackets]. Reads the nodes
// rather than changing them: React still owns them and removes them after the test.
function shown(text: string, q: string) {
  const { container } = render(<Highlight text={text} q={q} />);
  return Array.from(container.childNodes, (node) =>
    node.nodeName === "MARK"
      ? `[${node.textContent ?? ""}]`
      : (node.textContent ?? ""),
  ).join("");
}

describe("Highlight", () => {
  it("marks every match, ignoring case and keeping the name's own case", () => {
    expect(shown("BBQ Chicken Shack", "chicken")).toBe("BBQ [Chicken] Shack");
    expect(shown("Chicken & chicken", "CHICKEN")).toBe("[Chicken] & [chicken]");
  });

  it("treats regular expression characters in the filter as text", () => {
    expect(shown("C++ (large)", "c++")).toBe("[C++] (large)");
    expect(shown("C++ (large)", "(large)")).toBe("C++ [(large)]");
    expect(shown("Pho 2.0", ".")).toBe("Pho 2[.]0");
    expect(shown("Pho 200", ".")).toBe("Pho 200");
    expect(shown("a\\b [x] $5 ^ |", "\\b [x] $5 ^ |")).toBe(
      "a[\\b [x] $5 ^ |]",
    );
  });

  it("leaves text with no match, or no filter, as it is", () => {
    expect(shown("Oats", "chicken")).toBe("Oats");
    expect(shown("Oats", "")).toBe("Oats");
  });

  it("shows markup in a name as text", () => {
    const { container } = render(
      <Highlight text="<img src=x onerror=alert(1)>" q="img" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
