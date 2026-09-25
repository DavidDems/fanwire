/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The `/api` prefix and the strip are the production contract, not a dev
// convenience: CloudFront's viewer-request function does exactly this rewrite
// for the `/api/*` behaviour (wiki/CodeContext/Modules/0x00-architecture.md,
// "Frontend <-> API contract"). Matching it here means the browser only ever
// talks to one origin in either environment, so no CORS exists anywhere and
// none should be added — to this file or to `backend-dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.BACKEND_DEV_PORT ?? 8001}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    globals: false,
  },
});
