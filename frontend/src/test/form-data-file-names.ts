import { Blob as NodeBlob, File as NodeFile } from "node:buffer";

/**
 * Keep a file's name when a jsdom `FormData` is turned into a request body.
 *
 * Under Vitest 4 the test globals are mixed: `FormData`, `File` and `Blob` are
 * jsdom's, while `Request` and `fetch` are Node's (undici). Vitest bridges the
 * two by converting a jsdom `FormData` into a Node one, but it appends each
 * file as a bare `Blob`, so every file arrives as `blob`. A real browser keeps
 * the name, and `MediaWidget.test.tsx` asserts the name that reaches the
 * bucket, so the bridge has to keep it too.
 *
 * This wraps whatever `Request` is installed and does the conversion itself,
 * file names included, before Vitest's own bridge sees the body. It must be
 * imported before msw (`setupTests.ts` imports it first), because msw's fetch
 * interceptor builds its `Request` from the global at call time.
 *
 * The bytes are read from jsdom's internal buffer (the `impl` symbol), which
 * is exactly what Vitest's own bridge reads: a request body is built
 * synchronously, and every public reader of a jsdom `Blob` is asynchronous.
 * `src/test/harness.test.ts` pins the result.
 */

type Impl = { _buffer: Uint8Array };

function bytesOf(blob: Blob): Uint8Array {
  const impl = Object.getOwnPropertySymbols(blob).find(
    (symbol) => symbol.description === "impl",
  );
  if (impl === undefined)
    throw new Error("not a jsdom Blob: no impl symbol to read its bytes from");
  return (blob as unknown as Record<symbol, Impl>)[impl]._buffer;
}

const BaseRequest = globalThis.Request;
const JsdomFormData = globalThis.FormData;
const JsdomFile = globalThis.File;

// Node's own FormData, recovered from a Node Response: the global name now
// points at jsdom's.
const NodeFormData = (
  await new BaseRequest("http://form-data.invalid/", {
    method: "POST",
    body: new URLSearchParams(),
  }).formData()
).constructor as typeof FormData;

function toNodeFormData(form: FormData): FormData {
  const converted = new NodeFormData();
  form.forEach((value, key) => {
    if (typeof value === "string") {
      converted.append(key, value);
      return;
    }
    // The DOM lib types every non-string entry as `File`, but a bare jsdom
    // `Blob` can land here too, so widen before telling them apart.
    const blob: Blob = value;
    const copy =
      blob instanceof JsdomFile
        ? new NodeFile([bytesOf(blob)], blob.name, { type: blob.type })
        : new NodeBlob([bytesOf(blob)], { type: blob.type });
    converted.append(
      key,
      copy as unknown as Blob,
      blob instanceof JsdomFile ? blob.name : "blob",
    );
  });
  return converted;
}

if (JsdomFormData !== NodeFormData) {
  class FileNameKeepingRequest extends BaseRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(
        input,
        init?.body instanceof JsdomFormData
          ? { ...init, body: toNodeFormData(init.body) }
          : init,
      );
    }
  }
  globalThis.Request = FileNameKeepingRequest;
}
