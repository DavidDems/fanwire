import type { UnitBudget } from "../bundle-budget";

/**
 * FRONTEND-047: React 19, a dependency major under ADR 0041 (ADR 0036's
 * route). Measured by the test's build against `BASE` (main a777aae, vite 8)
 * on React 19.3.1 with this unit's react-hooks 7 fixes; React 18 builds
 * under every ceiling here.
 *
 * - The entry: React 19 is 172,594 bytes gzip and 554,149 raw, nine chunks
 *   (`react-dom` 19's client build is the growth; no application code moves
 *   it). Against the base's 149,210 and 474,565 that is +23,384 and +79,584.
 *   Declared with under 1% of the entry as headroom: +25,000 and +85,000.
 *   React 18 measures 149,239 and 474,631.
 * - The trim: `/search` stays eager. Loading `SearchPage` lazily made the
 *   React 19 entry larger (172,932 gzip, ten chunks), as the home page's
 *   search rail shares its code.
 * - `ComposePage`: 3,745 in the base; 3,822 on React 18 and 3,855 on 19, as
 *   `useAttachments` keeps its summaries in state (react-hooks 7's `refs`).
 * - `StatsNavigator`: 3,832 in the base; 3,901 on React 18 and 3,927 on 19,
 *   as a caller's level view renders through a component of its own.
 *
 * Each lazy ceiling is the larger measurement plus headroom.
 */
export default {
  unit: "FRONTEND-047",
  dependencyMajor: { name: "react 19", decision: "ADR 0041" },
  entryJsGzipGrowth: 25_000,
  entryJsRawGrowth: 85_000,
  changed: {
    ComposePage: 4_000,
    StatsNavigator: 4_100,
  },
} satisfies UnitBudget;
