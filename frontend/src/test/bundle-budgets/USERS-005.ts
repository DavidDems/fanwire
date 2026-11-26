import type { UnitBudget } from "../bundle-budget";

/**
 * USERS-005 replaces the eight avatar presets with two palette colours.
 *
 * Measured on outstanding-track-6 at b1e4e09 with this test's build, before
 * and after the unit (gzip bytes):
 *
 * - Entry JS: 147,272 → 146,947 gzip, 465,831 → 465,011 raw. The presets'
 *   drawings leave the shared Avatar, so the entry shrinks; no growth is
 *   declared.
 * - Entry CSS: 7,449 → 7,449 (Avatar's ring replaces the drawings' rule).
 * - ProfilePage: 2,936 → 3,241, the two colour groups replacing the preset
 *   grid. Ceiling 3,400.
 * - css:ProfilePage.css: 734 → 794, the groups' layout. Ceiling 900.
 *
 * Every other lazy output moved by 5 B or less, within the tolerance.
 */
export default {
  unit: "USERS-005",
  entryJsGzipGrowth: 0,
  entryJsRawGrowth: 0,
  entryCssGzipGrowth: 0,
  changed: {
    ProfilePage: 3_400,
    "css:ProfilePage.css": 900,
  },
} satisfies UnitBudget;
