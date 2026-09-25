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
    // The test environment's `VITE_*` values, committed on purpose.
    //
    // `src/config.ts` throws at module load on a missing variable, so any test
    // that (transitively) imports it needs all five present. Locally Vite loads
    // the untracked `frontend/.env.local` and they are — but `.dockerignore`
    // excludes `**/.env.*`, so the `frontend-test` container and CI have no env
    // file at all. Without this block a test that statically imports anything
    // reaching `config.ts` passes here and fails only in the container, which
    // is the exact defect class `wiki/CodeContext/Modules/0x08-frontend.md`
    // records twice already.
    //
    // `test.env` also *wins* over `.env.local` (Vite: `.env.[mode]` outranks
    // `.env.local`), so a test run reads these values on every machine and the
    // real dev pool ids never reach a test. They are deliberately fake, and
    // they are the same placeholders `config.test.ts` stubs with. Not secrets:
    // a pool id and a public SPA client id ship in the bundle anyway.
    env: {
      VITE_API_BASE_URL: "/api",
      VITE_COGNITO_REGION: "eu-west-2",
      VITE_COGNITO_USER_POOL_ID: "eu-west-2_TESTPOOL",
      VITE_COGNITO_CLIENT_ID: "test-spa-client-id",
      VITE_MEDIA_BASE_URL: "https://media.test.invalid",
    },
    setupFiles: ["./src/setupTests.ts"],
    globals: false,
  },
});
