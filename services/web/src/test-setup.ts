import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { server } from "./test-server";

// At the top level, not in beforeAll: setup files run before test files are
// imported, and openapi-fetch keeps a reference to fetch when src/api/client.ts
// is imported. MSW must have patched fetch by then, or requests skip it.
// "error": a request no handler covers fails the test instead of reaching the network.
server.listen({ onUnhandledFrame: "error" });

// How long findBy* and waitFor keep retrying. The default, 1 s, is shorter than a
// busy machine takes for a first dynamic import (the chart chunk) or a few pages
// of paging, which made those tests fail under load and pass alone. A wait still
// ends as soon as its check passes, so a green run is no slower.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
