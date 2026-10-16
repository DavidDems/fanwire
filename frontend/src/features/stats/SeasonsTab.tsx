import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { Field, describeField } from "../../components/FormField";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { SEASONS_KEY, TEAMS_KEY, fetchSeasons, fetchTeams } from "./api";
import { LeagueView } from "./LeagueView";
import styles from "./Stats.module.css";
import { TeamSearch } from "./TeamSearch";
import { TeamSeasonView } from "./TeamSeasonView";

const SEASON_ID = "stats-season";

/**
 * `/stats/seasons`: a season picker and a team search bar over either the
 * league view (champion, standings, leaders, games) or one team's season.
 *
 * **The URL is the state.** `?season=` is the picked season and `?team=` the
 * chosen team, through `useSearchParams`, so a reload, a shared link and Back
 * all show what was on screen. The default season is the newest one from
 * `GET /events/seasons`, and it is **not** written into the URL until the user
 * picks one, so `/stats/seasons` stays the address of "the current season".
 */
export function SeasonsTab() {
  const [params, setParams] = useSearchParams();
  const seasons = useQuery({ queryKey: SEASONS_KEY, queryFn: fetchSeasons });
  const teams = useQuery({ queryKey: TEAMS_KEY, queryFn: fetchTeams });

  const picked = params.get("season");
  const season = picked ?? seasons.data?.[0] ?? null;
  const rawTeam = Number(params.get("team"));
  const teamId =
    params.has("team") && Number.isSafeInteger(rawTeam) && rawTeam > 0
      ? rawTeam
      : null;
  const options = seasons.data ?? [];

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
        <Field id={SEASON_ID} label="Season">
          <select
            {...describeField(SEASON_ID)}
            value={season ?? ""}
            disabled={options.length === 0}
            onChange={(event) => {
              const value = event.target.value;
              update((next) => next.set("season", value));
            }}
          >
            {/* A season in the address the list does not hold still shows. */}
            {season !== null && !options.includes(season) ? (
              <option value={season}>{season}</option>
            ) : null}
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </Field>
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

      {season === null ? (
        seasons.isError ? (
          <InlineAlert>
            We could not load the seasons just now. Please try again.
          </InlineAlert>
        ) : seasons.isPending ? (
          <StatusLine>Loading the seasons…</StatusLine>
        ) : (
          <EmptyState>There are no seasons to show yet.</EmptyState>
        )
      ) : teamId === null ? (
        <LeagueView season={season} seasonInUrl={picked} teams={teams.data} />
      ) : (
        <TeamSeasonView
          teamId={teamId}
          season={season}
          seasonInUrl={picked}
          teams={teams.data}
        />
      )}
    </div>
  );
}
