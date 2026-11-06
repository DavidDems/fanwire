/**
 * FRONTEND-036: `useMediaQuery(query)`, the one place a viewport width reaches
 * JavaScript. The home page mounts its right rail from `(min-width: 72em)`
 * through it, so a phone never mounts the rail or makes its requests.
 *
 * - It answers whether `query` matches now, and asks `matchMedia` exactly that
 *   query.
 * - It listens for `change`, so a resize across the breakpoint re-renders with
 *   the new answer, with no reload; and it stops listening on unmount.
 * - Where there is no `matchMedia` (jsdom, and so every other test in the
 *   suite) it answers `false`: the narrow layout, with nothing extra mounted.
 *
 * jsdom has no `matchMedia`; `stubViewport` (`test/search.ts`) stands in for
 * it here. The hook never stubs or polyfills it itself, which is read from
 * the source below.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { readSrcFile } from "../test/css";
import { stubViewport, type ViewportStub } from "../test/search";
import { useMediaQuery } from "./useMediaQuery";

const WIDE = "(min-width: 72em)";

let viewport: ViewportStub | null = null;

function at(width: number): ViewportStub {
  viewport = stubViewport(width);
  return viewport;
}

afterEach(() => {
  viewport?.restore();
  viewport = null;
});

describe("useMediaQuery", () => {
  it.each([
    [1152, true],
    [1280, true],
    [1920, true],
    [1151, false],
    [1024, false],
    [360, false],
  ])("at %i px, (min-width: 72em) is %s", (width, expected) => {
    at(width);

    const { result } = renderHook(() => useMediaQuery(WIDE));

    expect(result.current).toBe(expected);
  });

  it("asks matchMedia exactly the query it was given", () => {
    const stub = at(1280);

    renderHook(() => useMediaQuery(WIDE));

    expect(stub.queries.length).toBeGreaterThan(0);
    expect(new Set(stub.queries)).toEqual(new Set([WIDE]));
  });

  it("follows a resize across the breakpoint both ways, with no remount", () => {
    const stub = at(1024);
    const { result } = renderHook(() => useMediaQuery(WIDE));
    expect(result.current).toBe(false);

    stub.setWidth(1152);
    expect(result.current).toBe(true);

    stub.setWidth(1151);
    expect(result.current).toBe(false);

    stub.setWidth(1920);
    expect(result.current).toBe(true);
  });

  it("listens while mounted and stops listening on unmount", () => {
    const stub = at(1280);
    const { unmount } = renderHook(() => useMediaQuery(WIDE));
    expect(stub.listenerCount()).toBeGreaterThan(0);

    unmount();

    expect(stub.listenerCount()).toBe(0);
  });

  it("follows a new query when the argument changes", () => {
    at(1024);
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useMediaQuery(query),
      { initialProps: { query: WIDE } },
    );
    expect(result.current).toBe(false);

    rerender({ query: "(min-width: 40em)" });

    expect(result.current).toBe(true);
  });

  it("answers false, and does not throw, where there is no matchMedia", () => {
    // jsdom's window has the property, set to undefined: not a function.
    expect(typeof window.matchMedia).not.toBe("function");

    const { result } = renderHook(() => useMediaQuery(WIDE));

    expect(result.current).toBe(false);
  });
});

describe("the hook's source", () => {
  it("lives in src/routes and never stubs or polyfills matchMedia", () => {
    const source = readSrcFile("routes/useMediaQuery.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1");

    expect(source).toMatch(/export\s+function\s+useMediaQuery\b/);
    expect(source).toMatch(/matchMedia/);
    expect(source).not.toMatch(/matchMedia\s*=(?!=)/);
    expect(source).not.toMatch(/defineProperty|stubGlobal/);
  });
});
