import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { server } from "./test-server";

// At the top level, not in beforeAll: setup files run before test files are
// imported, and openapi-fetch keeps a reference to fetch when src/api/client.ts
// is imported. MSW must have patched fetch by then, or requests skip it.
// "error": a request no handler covers fails the test instead of reaching the network.
server.listen({ onUnhandledFrame: "error" });

afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
