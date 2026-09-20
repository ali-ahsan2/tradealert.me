import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The product serves static files out of /static via FastAPI + nginx. Two
// HTML entries: the public product and the admin-only Lab. emptyOutDir stays
// false on purpose: pruned hashed assets would 404 for visitors still holding
// the previous index page.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../static",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: "index.html",
        lab: "lab.html",
      },
    },
  },
  server: {
    port: 5173,
  },
});