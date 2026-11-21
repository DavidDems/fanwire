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
 * The base, measured by this test's own build on main 85e3527 (vite 7),
 * folding in every unit whose file was still here: FRONTEND-037, 040, 043
 * and 044 and USERS-008, all merged. One tree, so every number is its
 * single measurement. Earlier folds: 2e29dac (FRONTEND-031, 034, 035, 036,
 * 038 and 039, USERS-006 and 007, EVENTS-013), FRONTEND-030 at 9d0012f,
 * EVENTS-012 at 4d714ef, EVENTS-011 and POSTS-008 at b1dfa99, USERS-004 and
 * FRONTEND-023, 024, 026 and 027 at 4795f19. The entry, its stylesheet, and
 * every lazy output → gzip bytes. Measure with the test's build, not
 * `npm run build`: under Vitest the build inlines `test.env`'s `VITE_*`
 * values, which makes the entry about 0.2 kB larger raw.
 */
export const BASE = {
  entryJsGzip: 152_248,
  entryJsRaw: 479_071,
  entryCssGzip: 7_031,
  lazy: {
    AccountSettings: 2_335,
    "AuthPage.module": 158,
    ComposePage: 3_642,
    ConfirmPage: 1_054,
    errors: 241,
    ForgotPasswordPage: 1_083,
    format: 489,
    GameCard: 611,
    GamePage: 3_905,
    HistoryPage: 1_047,
    NotificationsPage: 1_742,
    ok: 150,
    PeriodScores: 471,
    PlayerPage: 3_932,
    PlayerResults: 824,
    PlayersTab: 590,
    ProfilePage: 2_837,
    ProfileSetupPage: 1_413,
    RecentGames: 739,
    RecordsTab: 5_859,
    SchedulePage: 2_267,
    SeasonsTab: 1_737,
    SegmentedTabs: 700,
    SignInPage: 987,
    SignUpPage: 920,
    stats: 714,
    "Stats.module": 454,
    "StatsNav.module": 655,
    StatsNavigator: 3_813,
    StatsPage: 401,
    StatsPicker: 2_256,
    useQueries: 1_526,
    VisuallyHidden: 142,
    "css:AccountSettings.css": 403,
    "css:AuthPage.css": 273,
    "css:ComposePage.css": 366,
    "css:GameCard.css": 499,
    "css:GamePage.css": 856,
    "css:HistoryPage.css": 174,
    "css:NotificationsPage.css": 496,
    "css:PlayerPage.css": 879,
    "css:ProfilePage.css": 724,
    "css:RecentGames.css": 244,
    "css:SchedulePage.css": 557,
    "css:SegmentedTabs.css": 432,
    "css:Stats.css": 491,
    "css:StatsNav.css": 1_813,
    "css:StatsPage.css": 398,
    "css:StatsPicker.css": 466,
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
