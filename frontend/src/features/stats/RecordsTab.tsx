import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import {
  RECORDS_KEY,
  recordQuery,
  type RecordGroup,
  type RecordsSummaryOut,
} from "../../api/records";
import { seasonsQuery } from "../../api/stats";
import {
  NoSeason,
  SeasonSelect,
} from "../../components/stats-nav/SeasonSelect";
import {
  StatsNavigator,
  type StatsLevel,
  type StatsNavAdapter,
} from "../../components/stats-nav/StatsNavigator";
import { groupTitle } from "../../components/stats-nav/recordLabels";
import {
  RecordLevel,
  RecordTitle,
} from "../../components/stats-nav/RecordLevel";
import { RecordsLevel } from "../../components/stats-nav/RecordsLevel";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { Leaders } from "./Leaders";
import { ROUTE_LINKS } from "./links";
import styles from "./Stats.module.css";

const VIEWS = [
  { id: "historical", label: "Historical" },
  { id: "seasonal", label: "Seasonal" },
];

/** The address of a records stack: its group, or its record. */
function search(stack: StatsLevel[]): URLSearchParams {
  const result = new URLSearchParams();
  const top = stack[stack.length - 1];
  if (top?.kind === "record") result.set("record", top.id);
  else if (top?.kind === "records" && top.group === "player")
    result.set("group", "player");
  return result;
}

function href(stack: StatsLevel[]): string {
  const query = search(stack).toString();
  return query === "" ? "/stats/records" : `/stats/records?${query}`;
}

/**
 * `/stats/records`: a Historical / Seasonal bar over the records navigator
 * or the season's leaders.
 *
 * **The URL is the state, and this is the navigator's route adapter.**
 * `?view=seasonal` is Seasonal (Historical is the default and is not
 * written); on Historical, `?group=player` is the Player cards (Team is the
 * default) and `?record=<id>` a record's list, over its group's cards; on
 * Seasonal, `?season=` is the picked season (the newest by default). An
 * unknown value shows the default. The bars replace the history entry, and
 * switching the view drops the other view's parameters; opening and popping
 * a level push the address of the new stack.
 *
 * A record level's group is its list's (or the cached summary's, which says
 * the same), so `?record=` never carries `group`; until the read lands,
 * the id's team- or player- prefix supplies it. Unknown prefixes keep the
 * "Records" fallback.
 */
export function RecordsTab() {
  const [params, setParams] = useSearchParams();
  const seasonal = params.get("view") === "seasonal";

  return (
    <div className={styles.tab}>
      <SegmentedTabs
        label="Records view"
        tabs={VIEWS}
        value={seasonal ? "seasonal" : "historical"}
        onChange={(id) =>
          setParams(id === "seasonal" ? { view: "seasonal" } : {}, {
            replace: true,
          })
        }
      >
        <div className={styles.tab}>
          {seasonal ? (
            <Seasonal
              picked={params.get("season")}
              onPick={(season) =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("season", season);
                  return next;
                })
              }
            />
          ) : (
            <Historical
              recordId={params.get("record") || null}
              group={params.get("group") === "player" ? "player" : "team"}
              go={(stack, replace) => setParams(search(stack), { replace })}
            />
          )}
        </div>
      </SegmentedTabs>
    </div>
  );
}

function Historical({
  recordId,
  group,
  go,
}: {
  recordId: string | null;
  group: RecordGroup;
  go: (stack: StatsLevel[], replace: boolean) => void;
}) {
  const cached = useQueryClient()
    .getQueryData<RecordsSummaryOut>(RECORDS_KEY)
    ?.records.find((record) => record.id === recordId)?.group;
  const list = useQuery({
    ...recordQuery(recordId ?? ""),
    enabled: recordId !== null,
  });

  const stack: StatsLevel[] =
    recordId === null
      ? [{ kind: "records", group }]
      : [
          {
            kind: "records",
            group:
              list.data?.group ??
              cached ??
              (recordId.startsWith("player-")
                ? "player"
                : recordId.startsWith("team-")
                  ? "team"
                  : null),
          },
          { kind: "record", id: recordId },
        ];

  const adapter: StatsNavAdapter = {
    ...ROUTE_LINKS,
    // A records level is shown alone, a record over its group's.
    levelHref: (level) =>
      href(level.kind === "records" ? [level] : [stack[0], level]),
  };

  return (
    <StatsNavigator
      stack={stack}
      adapter={adapter}
      levelViews={{
        name: (level) =>
          level.kind === "records" ? (
            groupTitle(level.group)
          ) : level.kind === "record" ? (
            <RecordTitle id={level.id} />
          ) : null,
        view: (level, { open, replace }) =>
          level.kind === "records" ? (
            <RecordsLevel
              level={level}
              adapter={adapter}
              onGroup={(group) => replace({ kind: "records", group })}
              onRecord={(id) => open({ kind: "record", id })}
            />
          ) : level.kind === "record" ? (
            <RecordLevel level={level} adapter={adapter} />
          ) : null,
      }}
      open={(level) => go([...stack, level], false)}
      replace={(level) => go([...stack.slice(0, -1), level], true)}
      pop={(toDepth) => go(stack.slice(0, toDepth), false)}
    />
  );
}

function Seasonal({
  picked,
  onPick,
}: {
  picked: string | null;
  onPick: (season: string) => void;
}) {
  const seasons = useQuery(seasonsQuery());
  const season = picked ?? seasons.data?.[0] ?? null;

  return (
    <>
      <div className={styles.controls}>
        <SeasonSelect
          season={season}
          options={seasons.data ?? []}
          onPick={onPick}
        />
      </div>
      {season === null ? (
        <NoSeason seasons={seasons} />
      ) : (
        <>
          <h2>{season} leaders</h2>
          <Leaders season={season} />
        </>
      )}
    </>
  );
}
