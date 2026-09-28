import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useSyncExternalStore } from "react";

import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import type { ComposeMediator } from "./ComposeMediator";
import { activeMentionQuery, gameMentionToken, teamMentionToken } from "./mentions";

/**
 * The mention dropdown.
 *
 * It reads the draft the mediator publishes, decides from the text alone what is
 * being completed, and reports the chosen token back. It never touches the text
 * box and never touches the media widget — the shared draft is the whole of the
 * connection between them.
 *
 * Nothing is fetched until a trigger is actually typed. That is not an
 * optimisation: the composer's own tests assert it makes no request when it
 * mounts, and the route table's tests run with `onUnhandledRequest: "error"`.
 *
 * The suggestions are ordinary buttons rather than an ARIA combobox. A button is
 * keyboard-reachable with no `aria-activedescendant` bookkeeping, and a
 * half-implemented combobox is worse for a screen reader than a list of plainly
 * labelled buttons.
 */

type GameOut = components["schemas"]["GameOut"];
type TeamOut = components["schemas"]["TeamOut"];

export interface MentionAutocompleteProps {
  mediator: ComposeMediator;
}

interface Suggestion {
  key: string;
  /** What the button says — and the only thing a test may find it by. */
  label: string;
  /** What choosing it writes into the draft. */
  token: string;
}

async function fetchGames(): Promise<GameOut[]> {
  const { data, response } = await apiClient.GET("/events/games");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /events/games answered ${response.status}`);
  }
  return data;
}

async function fetchTeams(): Promise<TeamOut[]> {
  const { data, response } = await apiClient.GET("/events/teams");
  if (!response.ok || data === undefined) {
    throw new Error(`GET /events/teams answered ${response.status}`);
  }
  return data;
}

/**
 * Games are filtered — and labelled — by their id.
 *
 * Not a UI preference: `GameOut` carries team *ids*, scores and a date, and no
 * human-readable name. Resolving the two team ids to names would mean a second
 * request and a join this control has no business doing, so the id the user is
 * typing is the thing they match against and the date and score are what tell
 * two games apart.
 */
function gameSuggestions(games: GameOut[], query: string): Suggestion[] {
  return games
    .filter((game) => String(game.id).includes(query))
    .map((game) => ({
      key: `game-${game.id}`,
      label: `Game ${game.id} · ${format(parseISO(game.date), "d MMM yyyy")} · ${game.home_score}–${game.away_score}`,
      token: gameMentionToken(game.id),
    }));
}

function teamSuggestions(teams: TeamOut[], query: string): Suggestion[] {
  const needle = query.toLowerCase();
  return teams
    .filter(
      (team) =>
        team.name.toLowerCase().includes(needle) ||
        team.abbreviation.toLowerCase().includes(needle),
    )
    .map((team) => ({
      key: `team-${team.id}`,
      label: `${team.name} (${team.abbreviation})`,
      token: teamMentionToken(team.abbreviation),
    }));
}

export function MentionAutocomplete({ mediator }: MentionAutocompleteProps) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const active = activeMentionQuery(draft.text);

  // `enabled` is what keeps the composer silent: one trigger asks for one list,
  // and neither is asked for while the user is writing ordinary prose.
  const games = useQuery({
    queryKey: ["events", "games"],
    queryFn: fetchGames,
    enabled: active?.trigger === "#",
  });
  const teams = useQuery({
    queryKey: ["events", "teams"],
    queryFn: fetchTeams,
    enabled: active?.trigger === "$",
  });

  if (active === null) return null;

  const offeringGames = active.trigger === "#";
  const source = offeringGames ? games : teams;

  if (source.isError) {
    return <p role="alert">We could not load suggestions just now. You can keep typing.</p>;
  }

  const suggestions = offeringGames
    ? gameSuggestions(games.data ?? [], active.query)
    : teamSuggestions(teams.data ?? [], active.query);

  return (
    <section aria-label={offeringGames ? "Game suggestions" : "Team suggestions"}>
      {source.isFetching && suggestions.length === 0 ? <p role="status">Looking…</p> : null}
      <ul>
        {suggestions.map((suggestion) => (
          <li key={suggestion.key}>
            <button
              type="button"
              onClick={() => {
                mediator.send("mentions", {
                  kind: "mention-inserted",
                  token: suggestion.token,
                });
              }}
            >
              {suggestion.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
