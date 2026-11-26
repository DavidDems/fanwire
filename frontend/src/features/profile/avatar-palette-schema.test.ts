/**
 * USERS-005: the avatar's two colour lists are one list each, end to end.
 *
 * The backend's allowlists are `Literal` types in `app.users.schemas`, so the
 * generated `api/schema.d.ts` carries each as a union. The palette the
 * picker shows is `INNER_COLORS` and `OUTER_COLORS` in `lib/teamColors.ts`.
 * The assertions below are types: if either side gains, loses or renames a
 * key, `npm run typecheck` fails, before any test runs. The runtime case
 * keeps Vitest from reporting an empty file, and pins the order the picker
 * lists them in.
 */
import { describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { INNER_COLORS, OUTER_COLORS } from "../../lib/teamColors";

type Schemas = components["schemas"];

/** Exact type equality: neither side may be wider or narrower. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type PaletteKeys<T extends readonly { key: string }[]> = T[number]["key"];

type RequestInner = NonNullable<Schemas["UpdateMeRequest"]["avatar_inner_color"]>;
type RequestOuter = NonNullable<Schemas["UpdateMeRequest"]["avatar_outer_color"]>;
type MeInner = NonNullable<Schemas["MeOut"]["avatar_inner_color"]>;
type MeOuter = NonNullable<Schemas["MeOut"]["avatar_outer_color"]>;
type PublicInner = NonNullable<Schemas["PublicUserOut"]["avatar_inner_color"]>;
type PublicOuter = NonNullable<Schemas["PublicUserOut"]["avatar_outer_color"]>;
type AuthorInner = NonNullable<Schemas["AuthorView"]["avatar_inner_color"]>;
type AuthorOuter = NonNullable<Schemas["AuthorView"]["avatar_outer_color"]>;
type AccountInner = NonNullable<Schemas["AccountResult"]["avatar_inner_color"]>;
type AccountOuter = NonNullable<Schemas["AccountResult"]["avatar_outer_color"]>;

type Inner = PaletteKeys<typeof INNER_COLORS>;
type Outer = PaletteKeys<typeof OUTER_COLORS>;

// Compile-time contract: drift between the generated schema and the palette
// fails typecheck.
const contract: [
  Assert<Equal<RequestInner, Inner>>,
  Assert<Equal<RequestOuter, Outer>>,
  Assert<Equal<MeInner, Inner>>,
  Assert<Equal<MeOuter, Outer>>,
  Assert<Equal<PublicInner, Inner>>,
  Assert<Equal<PublicOuter, Outer>>,
  Assert<Equal<AuthorInner, Inner>>,
  Assert<Equal<AuthorOuter, Outer>>,
  Assert<Equal<AccountInner, Inner>>,
  Assert<Equal<AccountOuter, Outer>>,
  // The lists do not cross: no key is both.
  Assert<Equal<Extract<Inner, Outer>, never>>,
] = [true, true, true, true, true, true, true, true, true, true, true];

describe("the avatar colour lists (USERS-005)", () => {
  it("are the palette's own keys, in the brief's order", () => {
    expect(contract.every(Boolean)).toBe(true);
    expect(INNER_COLORS.map(({ key }) => key)).toEqual([
      "gold",
      "orange",
      "red",
      "green",
      "sky",
      "lavender",
      "silver",
      "teal",
    ]);
    expect(OUTER_COLORS.map(({ key }) => key)).toEqual([
      "blue",
      "crimson",
      "black",
      "purple",
      "forest",
    ]);
  });
});
