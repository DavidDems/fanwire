import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./test/server";

// `onUnhandledRequest: "error"` belongs here, on listen — `setupServer()` takes
// no options. It is the whole point of the harness: a request nobody wrote a
// handler for fails the test instead of leaving a component stuck in its
// loading state while the assertion about that loading state passes.
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  // `globals: false`, so Testing Library registers no auto-cleanup of its own.
  cleanup();
  // Handlers a test installed with `server.use` do not leak into the next one.
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
