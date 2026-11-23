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
 * is `css:` and its asset name, e.g. `css:ComposePage.css`. The entry and
 * the stylesheets it imports are budgeted on their own, and the entry is the
 * entry chunk plus its static imports (`entryClosure`), so no chunk of it is
 * ever a lazy output named here.
 *
 * Every number is in bytes, gzip by `zlib.gzipSync` at the default level;
 * 1 kB = 1000 bytes, as Vite reports it.
 */

const KB = 1000;

/** The fields of a Rollup output chunk `entryClosure` reads. */
export interface StaticImporter {
  fileName: string;
  /** Static imports only; Rollup keeps dynamic ones in `dynamicImports`. */
  imports: readonly string[];
}

/**
 * The entry chunk and every chunk it imports statically, transitively
 * (FRONTEND-046). Rolldown (vite 8) splits the entry into chunks
 * `index.html` preloads; they load with the entry, so they are the entry.
 * Rollup (vite 7) builds one entry chunk, so there it is the entry alone.
 * A chunk reached only through a dynamic import is lazy and not followed.
 * An import the output does not hold throws.
 */
export function entryClosure<C extends StaticImporter>(
  entry: C,
  chunks: readonly C[],
): C[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const seen = new Map<string, C>([[entry.fileName, entry]]);
  const pending = [entry];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const fileName of next.imports) {
      if (seen.has(fileName)) continue;
      const imported = byName.get(fileName);
      if (imported === undefined)
        throw new Error(
          `${next.fileName} imports ${fileName}, which is not in the output`,
        );
      seen.set(fileName, imported);
      pending.push(imported);
    }
  }
  return [...seen.values()];
}

/** What one unit changes in the bundle, in `bundle-budgets/<UNIT>.ts`. */
export interface UnitBudget {
  /** The unit's id, e.g. `FRONTEND-018`; the file is named after it. */
  unit: string;
  /**
   * How far the unit may grow the entry JS, gzip. At most 1000, unless the
   * unit lands a dependency major (`dependencyMajor`).
   */
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
  /**
   * The dependency major this unit lands, and the decision that lets its
   * entry growth past 1 kB gzip and past the 480 kB raw cap (ADR 0041, after
   * ADR 0036). Only such a unit may; its raw growth lifts the cap by as much.
   */
  dependencyMajor?: { name: string; decision: string };
}

/**
 * The base, measured by this test's own build on main 66fbb9b (vite 8,
 * React 19), folding in FRONTEND-047 (React 19, ADR 0041) and FRONTEND-048,
 * both merged. The entry is the entry chunk plus its static imports
 * (`entryClosure`), nine chunks; its CSS is `index.css` plus
 * `InlineAlert.css`. One tree, so every number is its single measurement.
 * Earlier folds: a777aae (vite 8; FRONTEND-046), 85e3527 (vite 7;
 * FRONTEND-037, 040, 043 and 044, USERS-008), 2e29dac (FRONTEND-031, 034,
 * 035, 036, 038 and 039, USERS-006 and 007, EVENTS-013), FRONTEND-030 at
 * 9d0012f, EVENTS-012 at 4d714ef, EVENTS-011 and POSTS-008 at b1dfa99,
 * USERS-004 and FRONTEND-023, 024, 026 and 027 at 4795f19. The entry, its
 * stylesheets, and every lazy output → gzip bytes. Measure with the test's
 * build, not `npm run build`: under Vitest the build inlines `test.env`'s
 * `VITE_*` values, which makes the entry about 0.2 kB larger raw.
 */
export const BASE = {
  entryJsGzip: 172_748,
  entryJsRaw: 554_736,
  entryCssGzip: 7_341,
  lazy: {
    AccountSettings: 2_389,
    "AuthPage.module": 139,
    ComposePage: 3_853,
    ConfirmPage: 1_163,
    errors: 231,
    ForgotPasswordPage: 1_200,
    format: 489,
    GameCard: 635,
    GamePage: 3_884,
    HistoryPage: 1_113,
    NotificationsPage: 1_852,
    ok: 140,
    PeriodScores: 494,
    PlayerPage: 3_855,
    PlayerResults: 902,
    PlayersTab: 640,
    ProfilePage: 2_908,
    ProfileSetupPage: 1_538,
    RecentGames: 783,
    RecordsTab: 5_915,
    SchedulePage: 2_282,
    SeasonsTab: 1_760,
    SegmentedTabs: 726,
    SignInPage: 1_097,
    SignUpPage: 1_028,
    stats: 697,
    "Stats.module": 528,
    "StatsNav.module": 504,
    StatsNavigator: 3_929,
    StatsPage: 429,
    StatsPicker: 2_258,
    useQueries: 1_506,
    VisuallyHidden: 155,
    "css:AccountSettings.css": 403,
    "css:AuthPage.css": 273,
    "css:ComposePage.css": 357,
    "css:GameCard.css": 499,
    "css:GamePage.css": 866,
    "css:HistoryPage.css": 174,
    "css:NotificationsPage.css": 496,
    "css:PlayerPage.css": 879,
    "css:ProfilePage.css": 734,
    "css:RecentGames.css": 243,
    "css:SchedulePage.css": 558,
    "css:SegmentedTabs.css": 433,
    "css:Stats.css": 490,
    "css:StatsNav.css": 1_830,
    "css:StatsPage.css": 396,
    "css:StatsPicker.css": 470,
  } as Record<string, number>,
};

/**
 * How far the entry may move, gzip, with no unit declaring anything: the
 * noise of an unrelated change (a dependency's patch release, a comment the
 * minifier keeps). Lazy outputs get the same.
 */
export const TOLERANCE = 0.1 * KB;

/**
 * The most one unit may grow the entry JS, gzip (R13, as the skeptic revised
 * it), unless it lands a dependency major (ADR 0041).
 */
export const ENTRY_GROWTH_PER_UNIT_MAX = 1 * KB;

/** No output file may be this many bytes raw or more (Vite's warning). */
export const FILE_RAW_LIMIT = 500_000;

/**
 * The entry's raw ceiling (R1), whatever units declare, except that a
 * dependency major's raw growth lifts it by as much (ADR 0041). 480 kB until
 * React 19; its fold set it to the measured React 19 entry (554,736 raw)
 * plus about 1%, rounded up to 100 B.
 */
export const ENTRY_JS_RAW_HARD_MAX = 560_300;

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
  let rawCap = ENTRY_JS_RAW_HARD_MAX;
  const claimed = new Map<string, string>();

  function claim(output: string, unit: string): void {
    const other = claimed.get(output);
    if (other !== undefined)
      throw new Error(`${unit} and ${other} both declare ${output}`);
    claimed.set(output, unit);
  }

  for (const budget of units) {
    const major = budget.dependencyMajor;
    if (
      major !== undefined &&
      (major.name.trim() === "" || !/^ADR \d{4}$/.test(major.decision))
    )
      throw new Error(
        `${budget.unit}: a dependency major needs a name and its decision as "ADR NNNN"`,
      );
    const growth = budget.entryJsGzipGrowth ?? 0;
    if (
      growth < 0 ||
      (major === undefined && growth > ENTRY_GROWTH_PER_UNIT_MAX)
    )
      throw new Error(
        `${budget.unit}: entry growth ${growth} is outside 0..${ENTRY_GROWTH_PER_UNIT_MAX}`,
      );
    const rawGrowth = budget.entryJsRawGrowth ?? 0;
    entryJsGzipMax += growth;
    entryJsRawMax += rawGrowth;
    if (major !== undefined) rawCap += rawGrowth;
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
    entryJsRawMax: Math.min(entryJsRawMax, rawCap),
    entryCssGzipMax,
    lazyMax,
    unchanged,
  };
}
