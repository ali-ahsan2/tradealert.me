import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The product serves static files out of /static via FastAPI + nginx, which
// does the SPA fallback, so the Vite build lands directly in ../static.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});