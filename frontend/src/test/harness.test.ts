/**
 * The properties that make an ordinary `import` — and an ordinary `FormData` —
 * work in a test.
 *
 * None is about a feature. All are about the harness behaving the same on a
 * developer's machine and inside `frontend-test`, and each was found the
 * expensive way: something that passed locally could not pass in the container.
 *
 * They are pinned here rather than written down, because a note in the wiki
 * saying "always dynamic-import the subject under test" is a rule every future
 * unit has to remember. A red test is not.
 */
import { File as NodeFile } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { screen } from "@testing-library/react";

import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

// Both imports are static and at module scope on purpose: that is the thing
// under test. Neither file may be moved into a hook or a dynamic import here.
import { apiClient } from "../api/client";
import { config } from "../config";
import { bytesOf } from "./form-data-file-names";
import { server } from "./server";

describe("the test environment supplies every VITE_* value", () => {
  it("loads config.ts on a static import, with no .env file present", () => {
    // `config.ts` throws at module load on a missing variable, so reaching this
    // line at all is half the assertion. CI and the container have no env file;
    // `vite.config.ts`'s `test.env` is what stands in for one.
    expect(config.apiBaseUrl).toBe("/api");
    expect(config.cognitoRegion).toBe("eu-west-2");
    expect(config.mediaBaseUrl).toBe("https://media.test.invalid");
  });

  it("uses the committed placeholders rather than whatever .env.local holds", () => {
    // `.env.[mode]` outranks `.env.local`, so a test never sees the real dev
    // pool. If `test.env` is removed, this reads the developer's own pool id
    // locally and fails, and fails differently in the container — either way,
    // red where the defect is.
    expect(config.cognitoUserPoolId).toBe("eu-west-2_TESTPOOL");
    expect(config.cognitoClientId).toBe("test-spa-client-id");
  });
});

describe("a request body carrying a file can be sent and read back", () => {
  /**
   * jsdom's `Blob` implements `slice`, `size` and `type` and nothing else — no
   * `arrayBuffer()`, `text()` or `stream()`. Everything that serializes a body
   * containing a file goes through one of those, so without them a `FormData`
   * carrying a `File` cannot be sent at all, and a handler cannot read one.
   *
   * The failure is worse than it sounds, and it is why this is pinned rather
   * than left to be rediscovered. On the host's Node 22 it happens to survive;
   * on the Node 20 that `docker/frontend.Dockerfile` and CI run, it throws
   * `AssertionError [ERR_ASSERTION]: false == true` from inside msw's handler
   * lookup — so the test fails with an empty recording, pointing nowhere near
   * the cause, and only in the container. `FRONTEND-004` lost a pass to exactly
   * that.
   */
  it("exposes the Blob readers jsdom leaves out", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "photo.jpg", {
      type: "image/jpeg",
    });

    expect(typeof file.arrayBuffer, "Blob.arrayBuffer()").toBe("function");
    expect(typeof file.text, "Blob.text()").toBe("function");
    expect(typeof file.stream, "Blob.stream()").toBe("function");
  });

  it("reads the bytes back out of a Blob", async () => {
    // A reader that resolves to the wrong thing is worse than an absent one:
    // the body would serialize and silently carry nothing.
    const file = new File([new Uint8Array([7, 8, 9])], "photo.jpg", {
      type: "image/jpeg",
    });

    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([7, 8, 9]),
    );
    expect(await new Blob(["hello"], { type: "text/plain" }).text()).toBe(
      "hello",
    );
  });

  it("round-trips a FormData carrying a file through msw", async () => {
    // The property that actually matters, and the one a media upload needs: a
    // multipart body built the ordinary way survives being sent, intercepted
    // and parsed, with the file's name and bytes intact.
    let received: FormData | null = null;
    server.use(
      http.post("https://upload.test.invalid/", async ({ request }) => {
        received = await request.formData();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const body = new FormData();
    body.append("key", "uploads/1.jpg");
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    body.append("file", new File([bytes], "photo.jpg", { type: "image/jpeg" }));

    const response = await fetch("https://upload.test.invalid/", {
      method: "POST",
      body,
    });

    expect(response.status).toBe(204);
    const form = received as FormData | null;
    if (form === null)
      throw new Error("the handler never received the request");
    expect([...form.keys()]).toEqual(["key", "file"]);
    expect(form.get("key")).toBe("uploads/1.jpg");
    const file = form.get("file") as File;
    expect(file.name).toBe("photo.jpg");
    expect(file.size).toBe(16);
    // The bytes as well as the size. On Node 24 on, a part rewrapped through
    // jsdom's `File` becomes the 13 bytes of "[object File]": the name survives
    // and only the contents give it away.
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it("names a bare Blob in a FormData 'blob' and keeps its bytes", async () => {
    let received: FormData | null = null;
    server.use(
      http.post("https://upload.test.invalid/", async ({ request }) => {
        received = await request.formData();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const bytes = new Uint8Array([4, 5, 6, 7]);
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: "image/jpeg" }));

    const response = await fetch("https://upload.test.invalid/", {
      method: "POST",
      body,
    });

    expect(response.status).toBe(204);
    const form = received as FormData | null;
    if (form === null)
      throw new Error("the handler never received the request");
    const file = form.get("file") as File;
    expect(file.name).toBe("blob");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it("makes a jsdom File an instance of Node's File", () => {
    // From undici 7 (Node 24 on), `Request.formData()` builds each part with the
    // global `File`, jsdom's, then asserts it is an `instanceof` the `File` undici
    // loaded with, Node's. Only the prototype chain can answer that. This line is
    // red on every Node until `setupTests.ts` links the two.
    expect(new File([], "a.txt")).toBeInstanceOf(NodeFile);
  });
});

describe("the web storage globals are jsdom's", () => {
  // Node 26 defines its own global `localStorage`, `undefined` without
  // `--localstorage-file`, and Vitest copies a jsdom key only when the global is
  // not already there. So this can only be red on Node 26: on Node 20 and 22
  // jsdom's storage is installed anyway.
  it.each([
    ["localStorage", () => localStorage],
    ["sessionStorage", () => sessionStorage],
  ])("round-trips an item through %s", (_name, storage) => {
    storage().setItem("harness-key", "harness-value");

    expect(storage().getItem("harness-key")).toBe("harness-value");

    storage().removeItem("harness-key");
  });
});

describe("msw intercepts a client built at module load", () => {
  it("serves a statically imported apiClient from a handler, not the network", async () => {
    // `createClient` captures `globalThis.fetch` when it runs, and `apiClient`
    // is constructed at module load — before any `beforeAll`. If `setupTests`
    // moves `server.listen()` back into a hook, this request leaves for the
    // real network and fails with ECONNREFUSED instead of returning the body.
    server.use(http.get("*/health", () => HttpResponse.json({ status: "ok" })));

    const { data, error } = await apiClient.GET("/health");

    expect(error).toBeUndefined();
    expect(data).toEqual({ status: "ok" });
  });
});

describe("a jsdom Blob's bytes are read on jsdom 25 and on jsdom 31", () => {
  // A request body is built synchronously and every public reader of a jsdom
  // Blob is asynchronous, so `form-data-file-names.ts` reads jsdom's internal
  // bytes, as Vitest's own bridge does. jsdom 25 keeps them as `_buffer` under
  // an own `Symbol("impl")`; jsdom 31 as `_bytes` behind a private field that
  // only its `implForWrapper` reaches. Each path is pinned with a stand-in.
  it("reads a real Blob", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);

    expect(bytesOf(new Blob([bytes]))).toEqual(bytes);
  });

  it.each(["_bytes", "_buffer"])(
    "reads an impl that keeps them as %s",
    (key) => {
      const bytes = new Uint8Array([9, 8, 7]);
      const blob = { [Symbol("impl")]: { [key]: bytes } } as unknown as Blob;

      expect(bytesOf(blob)).toEqual(bytes);
    },
  );

  it("names what it could not read", () => {
    expect(() => bytesOf({} as Blob)).toThrow(/jsdom Blob/);
  });
});

describe("an open menu is visible to role queries", () => {
  // `Menu` opens its list with `showPopover()`, which jsdom does not implement,
  // and jsdom 31's default stylesheet hides `[popover]:not(:popover-open)`. An
  // author rule outranks a user-agent one whatever its specificity, so the
  // harness's test-only rule is what keeps an open menu in the tree.
  it("declares [popover] { display: block }", () => {
    const rules = [...document.styleSheets].flatMap((sheet) => [
      ...sheet.cssRules,
    ]);
    const popover = rules.find(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === "[popover]",
    );

    expect(popover?.style.display).toBe("block");
  });

  it("finds a popover list by its role", () => {
    const list = document.createElement("ul");
    list.setAttribute("role", "menu");
    list.setAttribute("aria-label", "Harness menu");
    list.setAttribute("popover", "manual");
    document.body.append(list);

    try {
      expect(screen.getByRole("menu", { name: "Harness menu" })).toBe(list);
    } finally {
      list.remove();
    }
  });
});

describe("an unhandled request fails the test on msw 2 and on msw 3", () => {
  it("passes each version its own option", () => {
    // msw 2 reads `onUnhandledRequest`, msw 3 `onUnhandledFrame`; each ignores
    // the other's. Without msw 3's, an unhandled request only warns.
    // From the repository root (the container) or from `frontend/`.
    const file = ["src/setupTests.ts", "frontend/src/setupTests.ts"]
      .map((path) => join(process.cwd(), path))
      .find((path) => existsSync(path));
    if (file === undefined) throw new Error("setupTests.ts not found");
    const source = readFileSync(file, "utf8");

    expect(source).toMatch(/onUnhandledRequest:\s*"error"/);
    expect(source).toMatch(/onUnhandledFrame:\s*"error"/);
  });
});
