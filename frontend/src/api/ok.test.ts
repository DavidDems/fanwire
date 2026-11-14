import { describe, expect, it } from "vitest";
import { ok } from "./ok";

describe("shared API response boundary", () => {
  it("returns successful data, including null", () => {
    expect(
      ok(
        { data: [1], response: new Response(null, { status: 200 }) },
        "/events/seasons",
      ),
    ).toEqual([1]);
    expect(
      ok(
        { data: null, response: new Response(null, { status: 200 }) },
        "/events/seasons",
      ),
    ).toBeNull();
  });
  it("rejects failed or missing data with path and status", () => {
    expect(() =>
      ok({ response: new Response(null, { status: 503 }) }, "/events/records"),
    ).toThrow("GET /events/records answered 503");
    expect(() =>
      ok({ response: new Response(null, { status: 200 }) }, "/events/seasons"),
    ).toThrow("GET /events/seasons answered 200");
  });
});
