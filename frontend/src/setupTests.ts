import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { server } from "./test/server";

/**
 * Give jsdom's `Blob` the readers it does not implement.
 *
 * jsdom provides `slice`, `size` and `type` and stops there. Every path that
 * serializes a request body containing a file — `fetch` with a `FormData`, and
 * `Request.formData()` on the other side — reaches for `stream()`,
 * `arrayBuffer()` or `text()`, so without these a media upload cannot be sent
 * from a test and a handler cannot read one back.
 *
 * It has to be here rather than in the test that needs it. The body is
 * serialized by the runtime, long after any per-test setup, and a fixture
 * cannot reach into it — which is why `FRONTEND-004` ended up hand-encoding a
 * multipart body instead.
 *
 * Installed only when absent, so a future jsdom that implements these wins
 * over this and the harness stops carrying a patch it no longer needs.
 * `FileReader` is the reader jsdom *does* provide, and it is the same one a
 * real browser has, so nothing here invents behaviour the browser lacks.
 *
 * `src/test/harness.test.ts` pins all of it.
 */
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("the blob could not be read"));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * One chunk: these blobs are test fixtures, and a reader that had to reassemble
 * several would be more code than the thing it stands in for.
 *
 * A free function rather than the body of `Blob.prototype.stream`, so the blob
 * arrives as an argument instead of an alias of `this`.
 */
function blobStream(blob: Blob): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async start(controller) {
      try {
        controller.enqueue(new Uint8Array(await readBlob(blob)));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return readBlob(this);
  };

  Blob.prototype.text = async function text(this: Blob): Promise<string> {
    // UTF-8 explicitly: `FileReader.readAsText` would follow the blob's own
    // charset, and `Blob.text()` is specified as UTF-8 regardless.
    return new TextDecoder().decode(await readBlob(this));
  };

  Blob.prototype.stream = function stream(this: Blob) {
    return blobStream(this);
  };
}

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
