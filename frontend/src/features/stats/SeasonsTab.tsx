import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { seasonsQuery, TEAMS_KEY, fetchTeams } from "../../api/stats";
import {
  NoSeason,
  SeasonSelect,
} from "../../components/stats-nav/SeasonSelect";
import {
  StatsNavigator,
  type Conference,
  type StatsLevel,
  type StatsNavAdapter,
} from "../../components/stats-nav/StatsNavigator";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { ROUTE_LINKS } from "./links";
import styles from "./Stats.module.css";
import { TeamSearch } from "./TeamSearch";

function conference(value: string | null): Conference {
  return value === "east" || value === "west" ? value : "all";
}

/**
 * `/stats/seasons`: a season picker and a team search bar over the stats
 * navigator (the season's leaders moved to Records > Seasonal in
 * FRONTEND-019).
 *
 * **The URL is the state, and this is the navigator's route adapter.**
 * `?season=` is the picked season, `?conf=` the standings tab (`east` or
 * `west`; All is the default and is not written, and an unknown value shows
 * All) and `?team=` the team level, so a reload, a shared link and Back all
 * show what was on screen. The stack is built from them (the season level,
 * then the team's when `?team=` is set); opening and popping a level push the
 * address of the new stack, and a conference tab replaces it. The default
 * season is the newest one from `GET /events/seasons`, and it is **not**
 * written into the URL until the user picks one, so `/stats/seasons` stays
 * the address of "the current season".
 */
export function SeasonsTab() {
  const [params, setParams] = useSearchParams();
  const seasons = useQuery(seasonsQuery());
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: fetchTeams });

  const picked = params.get("season");
  const season = picked ?? seasons.data?.[0] ?? null;
  const rawTeam = Number(params.get("team"));
  const teamId =
    params.has("team") && Number.isSafeInteger(rawTeam) && rawTeam > 0
      ? rawTeam
      : null;
  const options = seasons.data ?? [];
  const base: StatsLevel | null =
    season === null
      ? null
      : { kind: "season", season, conf: conference(params.get("conf")) };
  const stack: StatsLevel[] =
    base === null
      ? []
      : teamId === null
        ? [base]
        : [base, { kind: "team", season: base.season, teamId }];

  /** The address of a stack: the season as it is, the conference and team. */
  function search(next: StatsLevel[]): URLSearchParams {
    const result = new URLSearchParams(params);
    const [first, second] = next;
    if (first?.kind === "season" && first.conf !== "all")
      result.set("conf", first.conf);
    else result.delete("conf");
    if (second?.kind === "team") result.set("team", String(second.teamId));
    else result.delete("team");
    return result;
  }

  const adapter: StatsNavAdapter = {
    ...ROUTE_LINKS,
    levelHref: (level) => {
      // A season level is shown alone, a team level over the season's.
      const query = search(
        level.kind === "season" ? [level] : [stack[0], level],
      ).toString();
      return query === "" ? "/stats/seasons" : `/stats/seasons?${query}`;
    },
  };

  function update(change: (next: URLSearchParams) => void): void {
    setParams((current) => {
      const next = new URLSearchParams(current);
      change(next);
      return next;
    });
  }

  return (
    <div className={styles.tab}>
      <div className={styles.controls}>
        <SeasonSelect
          season={season}
          options={options}
          onPick={(value) => update((next) => next.set("season", value))}
        />
        <TeamSearch
          teams={teams.data}
          selectedId={teamId}
          onChoose={(team) =>
            update((next) => next.set("team", String(team.id)))
          }
          onClear={() => update((next) => next.delete("team"))}
        />
      </div>

      {teams.isError ? (
        <InlineAlert>
          We could not load the teams just now, so the team search is empty.
        </InlineAlert>
      ) : null}

      {base === null ? (
        <NoSeason seasons={seasons} />
      ) : (
        <StatsNavigator
          stack={stack}
          adapter={adapter}
          open={(level) => setParams(search([...stack, level]))}
          replace={(level) =>
            setParams(search([...stack.slice(0, -1), level]), {
              replace: level.kind === "season",
            })
          }
          pop={(toDepth) => setParams(search(stack.slice(0, toDepth)))}
        />
      )}
    </div>
  );
}
