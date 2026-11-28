// PROTOTYPE, throwaway (issue #302). Serves this folder with services/web's own
// node_modules and the real color tokens.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react(), tailwindcss()] });
