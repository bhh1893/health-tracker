import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Tests must not depend on what an earlier test left mocked.
    restoreMocks: true,
    unstubGlobals: true,
    // Far from UTC, which is what CI runs in: a date bug that only shows away from
    // UTC would otherwise pass there.
    env: { TZ: "Pacific/Auckland" },
  },
});
