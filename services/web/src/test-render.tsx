import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

import { createQueryClient } from "./api/query-client";
import { CurrentUrl } from "./test-current-url";

export function renderAt(path: string, ui: ReactNode) {
  const client = createQueryClient();
  const view = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {ui}
        <CurrentUrl />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...render(view) };
}
