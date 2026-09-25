import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { server } from "./test/server";

// `onUnhandledRequest: "error"` belongs here, on listen — `setupServer()` takes
// no options. It is the whole point of the harness: a request nobody wrote a
// handler for fails the test instead of leaving a component stuck in its
// loading state while the assertion about that loading state passes.
//
// At module scope, deliberately, *not* inside `beforeAll`. `openapi-fetch`'s
// `createClient` captures `globalThis.fetch` when the client is constructed
// (`fetch: baseFetch = globalThis.fetch`), and `src/api/client.ts` constructs
// its singleton at module load. Setup files are evaluated before the test
// file's own imports, but a `beforeAll` in one runs *after* that whole module
// graph — so listening from a hook left every statically imported `apiClient`
// holding the unpatched fetch, and its requests went to the real network as
// `ECONNREFUSED` rather than to a handler. Listening here means msw has
// replaced `globalThis.fetch` before any module captures it, and an ordinary
// static `import { apiClient }` is intercepted. `src/test/harness.test.ts`
// pins it.
server.listen({ onUnhandledRequest: "error" });

afterEach(() => {
  // `globals: false`, so Testing Library registers no auto-cleanup of its own.
  cleanup();
  // Handlers a test installed with `server.use` do not leak into the next one.
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
