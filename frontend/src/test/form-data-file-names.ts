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
 * every public reader of a jsdom `Blob` is asynchronous. Two jsdom layouts are
 * read (FRONTEND-045, until FRONTEND-048 drops jsdom 25's):
 *
 * - jsdom 31 keeps the implementation behind a private field that only its
 *   generated `implForWrapper` reaches, and the bytes as `_bytes`.
 * - jsdom 25 keeps it under an own `Symbol("impl")`, and the bytes as
 *   `_buffer`.
 *
 * `src/test/harness.test.ts` pins both.
 */
import { createRequire } from "node:module";

type Impl = {
  _bytes?: Uint8Array<ArrayBuffer>;
  _buffer?: Uint8Array<ArrayBuffer>;
};

type ImplForWrapper = (wrapper: unknown) => Impl | null | undefined;

// jsdom has no "exports" map, so its generated bindings resolve by path. They
// moved in jsdom 28.1; the first path is today's, the second jsdom 25's.
const JSDOM_UTILS = [
  "jsdom/lib/generated/idl/utils.js",
  "jsdom/lib/jsdom/living/generated/utils.js",
];

function loadImplForWrapper(): ImplForWrapper | null {
  const require = createRequire(import.meta.url);
  for (const id of JSDOM_UTILS) {
    try {
      const { implForWrapper } = require(id) as {
        implForWrapper?: ImplForWrapper;
      };
      if (typeof implForWrapper === "function") return implForWrapper;
    } catch {
      // Not this jsdom's layout: try the next.
    }
  }
  return null;
}

const implForWrapper = loadImplForWrapper();

function implOf(blob: Blob): Impl | undefined {
  const viaBindings = implForWrapper?.(blob);
  if (viaBindings) return viaBindings;
  const symbol = Object.getOwnPropertySymbols(blob).find(
    (candidate) => candidate.description === "impl",
  );
  return symbol === undefined
    ? undefined
    : (blob as unknown as Record<symbol, Impl>)[symbol];
}

/** A jsdom `Blob`'s bytes, read synchronously. Exported for `harness.test.ts`. */
export function bytesOf(blob: Blob): Uint8Array<ArrayBuffer> {
  const impl = implOf(blob);
  const bytes = impl?._bytes ?? impl?._buffer;
  if (bytes === undefined)
    throw new Error("not a jsdom Blob: found no bytes to read");
  // jsdom 25's are a Node `Buffer`: view the same memory as a plain array.
  return new Uint8Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ) as Uint8Array<ArrayBuffer>;
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
