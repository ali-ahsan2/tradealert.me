import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Hosted-preview build: the real app and styles, a hash router in place of
// the history router, and a fetch that answers from captured API fixtures.
// Output is relative-pathed so the page can be served from any folder.
const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PREVIEW_OUT || path.join(here, "preview-dist");

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [{ find: /(.*)\/lib\/router\.jsx$/, replacement: path.join(here, "preview/router.jsx") }],
  },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: { input: { preview: path.join(here, "preview.html") } },
  },
});
