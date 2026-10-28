/**
 * The budgets `bundle-budget.test.ts` holds a production build to: a base
 * measured on `main`, plus what each unit in flight declares in its own file
 * under `bundle-budgets/` (Prompt 20, R12).
 *
 * **Why one file per unit.** The base pins every lazy output to its measured
 * size, and a unit's new sizes only exist after its implementation, when its
 * tests are frozen (`allow_test_edits_during_impl` is false). So a unit
 * declares, in its test commit, the outputs it changes, adds or removes and
 * the gzip ceiling of each. Two sibling units each add a file of their own,
 * so neither edits the other's lines and their PRs merge cleanly.
 *
 * **A merged unit is folded into the base.** Once a unit's PR has merged, the
 * next Director spec PR measures `main` again, writes the new sizes into
 * `BASE` and deletes the unit's file. So a later unit can re-declare an
 * output an earlier one changed, and two files in flight that declare the
 * same output are a real conflict, which `combine` refuses.
 *
 * **Names.** A JS chunk is its Rollup chunk name (no hash); a lazy stylesheet
 * is `css:` and its asset name, e.g. `css:ComposePage.css`. The entry chunk
 * and the stylesheet it imports are budgeted on their own.
 *
 * Every number is in bytes, gzip by `zlib.gzipSync` at the default level;
 * 1 kB = 1000 bytes, as Vite reports it.
 */

const KB = 1000;

/** What one unit changes in the bundle, in `bundle-budgets/<UNIT>.ts`. */
export interface UnitBudget {
  /** The unit's id, e.g. `FRONTEND-018`; the file is named after it. */
  unit: string;
  /** How far the unit may grow the entry JS chunk, gzip. At most 1000. */
  entryJsGzipGrowth?: number;
  /** How far the unit may grow the entry JS chunk, raw. */
  entryJsRawGrowth?: number;
  /** How far the unit may grow the entry CSS, gzip. */
  entryCssGzipGrowth?: number;
  /** Lazy outputs in the base whose size the unit changes → gzip ceiling. */
  changed?: Record<string, number>;
  /** New lazy outputs → gzip ceiling. Each must exist in the build. */
  added?: Record<string, number>;
  /** Lazy outputs in the base the unit removes. Each must be gone. */
  removed?: string[];
}

/**
 * The base, measured by this test's own build on origin/main e700415 (after
 * FRONTEND-021 and FRONTEND-022, whose budgets are folded in): the entry, its
 * stylesheet, and every lazy output → gzip bytes. Measure with the test's
 * build, not `npm run build`: the two differ by about 0.2 kB raw on the entry.
 */
export const BASE = {
  entryJsGzip: 149_998,
  entryJsRaw: 472_333,
  entryCssGzip: 5_661,
  lazy: {
    "AuthPage.module": 158,
    ComposePage: 3_820,
    ConfirmPage: 1_055,
    errors: 243,
    ForgotPasswordPage: 1_084,
    format: 431,
    GamePage: 4_050,
    NotificationsPage: 1_668,
    PlayerPage: 3_051,
    PlayersTab: 580,
    ProfilePage: 2_783,
    ProfileSetupPage: 1_414,
    RecordsTab: 3_183,
    SeasonsTab: 1_646,
    SignInPage: 989,
    SignUpPage: 876,
    "Stats.module": 377,
    StatsNavigator: 3_242,
    StatsPage: 400,
    VisuallyHidden: 143,
    PeriodScores: 470,
    StatsPicker: 2_187,
    stats: 760,
    PlayerResults: 824,
    "StatsNav.module": 312,
    "css:AuthPage.css": 273,
    "css:ComposePage.css": 411,
    "css:GamePage.css": 1_081,
    "css:NotificationsPage.css": 451,
    "css:PlayerPage.css": 704,
    "css:ProfilePage.css": 577,
    "css:Stats.css": 469,
    "css:StatsPicker.css": 466,
    "css:StatsNavigator.css": 364,
    "css:StatsPage.css": 398,
    "css:StatsNav.css": 1_056,
  } as Record<string, number>,
};

/**
 * How far the entry may move, gzip, with no unit declaring anything: the
 * noise of an unrelated change (a dependency's patch release, a comment the
 * minifier keeps). Lazy outputs get the same.
 */
export const TOLERANCE = 0.1 * KB;

/** The most one unit may grow the entry JS chunk, gzip (R13, as the skeptic revised it). */
export const ENTRY_GROWTH_PER_UNIT_MAX = 1 * KB;

/** No output file may be this many bytes raw or more (Vite's warning). */
export const FILE_RAW_LIMIT = 500_000;

/** The entry's raw ceiling, whatever units declare (R1). */
export const ENTRY_JS_RAW_HARD_MAX = 480 * KB;

/** What the build is held to once every unit's declarations are applied. */
export interface Budget {
  entryJsGzipMax: number;
  entryJsRawMax: number;
  entryCssGzipMax: number;
  /** Each lazy output the build must have → its gzip ceiling. */
  lazyMax: Record<string, number>;
  /** Which of `lazyMax` are undeclared base outputs, held within tolerance. */
  unchanged: Record<string, number>;
}

/**
 * The base with every unit's file applied. A declaration that contradicts
 * the base or another unit throws, so a wrong file fails loudly rather than
 * loosening the budget.
 */
export function combine(units: UnitBudget[]): Budget {
  const lazyMax: Record<string, number> = { ...BASE.lazy };
  const unchanged: Record<string, number> = { ...BASE.lazy };
  let entryJsGzipMax = BASE.entryJsGzip + TOLERANCE;
  let entryJsRawMax = BASE.entryJsRaw + TOLERANCE;
  let entryCssGzipMax = BASE.entryCssGzip + TOLERANCE;
  const claimed = new Map<string, string>();

  function claim(output: string, unit: string): void {
    const other = claimed.get(output);
    if (other !== undefined)
      throw new Error(`${unit} and ${other} both declare ${output}`);
    claimed.set(output, unit);
  }

  for (const budget of units) {
    const growth = budget.entryJsGzipGrowth ?? 0;
    if (growth < 0 || growth > ENTRY_GROWTH_PER_UNIT_MAX)
      throw new Error(
        `${budget.unit}: entry growth ${growth} is outside 0..${ENTRY_GROWTH_PER_UNIT_MAX}`,
      );
    entryJsGzipMax += growth;
    entryJsRawMax += budget.entryJsRawGrowth ?? 0;
    entryCssGzipMax += budget.entryCssGzipGrowth ?? 0;

    for (const [output, max] of Object.entries(budget.changed ?? {})) {
      if (!(output in BASE.lazy))
        throw new Error(`${budget.unit}: changed ${output} is not in the base`);
      claim(output, budget.unit);
      lazyMax[output] = max;
      delete unchanged[output];
    }
    for (const [output, max] of Object.entries(budget.added ?? {})) {
      if (output in BASE.lazy)
        throw new Error(
          `${budget.unit}: added ${output} is already in the base`,
        );
      claim(output, budget.unit);
      lazyMax[output] = max;
    }
    for (const output of budget.removed ?? []) {
      if (!(output in BASE.lazy))
        throw new Error(`${budget.unit}: removed ${output} is not in the base`);
      claim(output, budget.unit);
      delete lazyMax[output];
      delete unchanged[output];
    }
  }

  return {
    entryJsGzipMax,
    entryJsRawMax: Math.min(entryJsRawMax, ENTRY_JS_RAW_HARD_MAX),
    entryCssGzipMax,
    lazyMax,
    unchanged,
  };
}
