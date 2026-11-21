import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-046: the budget holds a vite 8 (Rolldown) build as well as a
 * vite 7 one. Against the base folded on `main` 85e3527 (vite 7), vite 8.3.8
 * with plugin-react 6.3.0 moves three things past tolerance, all from
 * Rolldown's chunking:
 *
 * - `ComposePage`: 3,642 bytes gzip on vite 7, 3,745 on vite 8.
 * - `StatsNav.module`: 655 on vite 7, 504 on vite 8. A shrink, but an
 *   undeclared output is held to ±100 bytes either way. Rolldown keeps the
 *   CSS-module map and its helper together in a different chunk.
 * - The entry CSS: 7,031 on vite 7. On vite 8 `InlineAlert.css` is split
 *   off with `InlineAlert`, a chunk of the entry's closure, so the entry CSS
 *   is two files, 7,066 + 275 = 7,341, each gzipped with its own overhead.
 *
 * Each ceiling is the larger measurement plus headroom. No entry JS growth:
 * the vite 8 entry closure (seven chunks, 149,210 gzip and 474,565 raw) is
 * under the base's 152,248 and 479,071.
 */
export default {
  unit: "FRONTEND-046",
  entryCssGzipGrowth: 400,
  changed: {
    ComposePage: 3_900,
    "StatsNav.module": 700,
  },
} satisfies UnitBudget;
