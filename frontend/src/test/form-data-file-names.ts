import { File as NodeFile } from "node:buffer";

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
 * The bytes are read from jsdom's internal Blob implementation, exactly as
 * Vitest's own bridge reads them: a request body is built synchronously, and
 * every public reader of a jsdom `Blob` is asynchronous. jsdom keeps the
 * implementation behind a private field that only its generated
 * `implForWrapper` reaches, and the bytes there as `_bytes`.
 *
 * `src/test/harness.test.ts` pins it.
 */
import { createRequire } from "node:module";

type Impl = { _bytes?: Uint8Array<ArrayBuffer> };

// jsdom has no "exports" map, so its generated bindings resolve by path.
const { implForWrapper } = createRequire(import.meta.url)(
  "jsdom/lib/generated/idl/utils.js",
) as { implForWrapper: (wrapper: unknown) => Impl | null };

/** A jsdom `Blob`'s bytes, read synchronously. Exported for `harness.test.ts`. */
export function bytesOf(blob: Blob): Uint8Array<ArrayBuffer> {
  const bytes = implForWrapper(blob)?._bytes;
  if (bytes === undefined)
    throw new Error("not a jsdom Blob: found no bytes to read");
  return bytes;
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
    const name = blob instanceof JsdomFile ? blob.name : "blob";
    // Already a named Node `File`, and no third argument to `append`, so undici
    // keeps this object. Given a filename or a bare `Blob` it rewraps with
    // `new File([value], ...)`, and on Node 24 on that reads the global, which
    // is jsdom's: a Node `File` is no part jsdom knows, so the body it would
    // send is the 13 bytes of "[object File]".
    converted.append(
      key,
      new NodeFile([bytesOf(blob)], name, {
        type: blob.type,
      }) as unknown as File,
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
