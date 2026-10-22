import { useQuery } from "@tanstack/react-query";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Field, describeField } from "../../components/FormField";
import { Button } from "../../components/ui/Button";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import type { ComposeMediator } from "./ComposeMediator";
import {
  careerLine,
  careerScopes,
  checkAddressLink,
  describeBareLink,
  describeCareer,
  describeGame,
  describeLine,
  fetchGameDetail,
  fetchPlayerDetail,
  fetchSeasons,
  fetchTeamGames,
  fetchTeams,
  gamesPlayed,
  isCompleted,
  playedLines,
  playerName,
  scopeName,
  searchPlayers,
  type GameOut,
  type PlayerListItemOut,
  type TeamOut,
} from "./attachmentReads";
import { dataLinkKey, type DataLink } from "./dataLink";
import styles from "./AttachmentPicker.module.css";

/**
 * The attachment picker (`FRONTEND-013`): attach one sports-data link to the
 * post — a completed game, a player's played line in one game, or a player's
 * career in one scope — and show what is attached.
 *
 * **One of the mediator's three colleagues**, beside the text box and the
 * media widget. It reports `link-attached` (which also replaces) and
 * `link-removed`, and reads the draft the mediator publishes to know what is
 * attached. It imports neither other colleague; `component-isolation.test.ts`
 * reads this file from disk to keep it that way. Undo is not here: it walks
 * back the mediator's history, so it sits beside Post on the page, as Undo
 * mention did.
 *
 * **A disclosure panel, not a dialog.** "Attach stats" is a button with
 * `aria-expanded` that opens a panel in the flow of the form card, under the
 * text box, because the composer may itself be opened over a page and a
 * dialog over a dialog is a trap. Focus moves to the first choice when it
 * opens, Escape closes it, and closing it — by Escape, by the button, or by
 * attaching — puts focus back on Attach stats.
 *
 * **Plain controls only** (`components/ui` primitives and native elements):
 * the three choices are `Button`s whose names stay fixed while `aria-pressed`
 * says which is chosen (`components.md` §2), a game is narrowed with two
 * native selects, and every game, player, search result and scope is a
 * labelled button in a list. A list of buttons needs no
 * `aria-activedescendant` bookkeeping, and a half-built combobox is worse for
 * a screen reader than buttons that say what they are.
 *
 * **What is offered is what the server accepts** (`attachmentReads.ts`): no
 * game with both scores 0, no did-not-play line, no career scope with no
 * games. The server checks again when the post is sent, and the page words
 * its refusals.
 *
 * **The summary is built from what the picker already read.** When a choice
 * attaches, its one-line description is remembered against the link's key, so
 * Undo — which restores an earlier link from a `DraftSnapshot` — shows that
 * link's words again without asking the server twice. A link the picker never
 * described (a template that carried one) still gets a plain line, so the
 * summary never claims nothing is attached when something is.
 *
 * **Nothing is fetched until it is needed**: the team, season and game lists
 * when a game choice is opened, a box score when a game is chosen, players as
 * the search is typed. The one read made on arrival is for a pre-filled
 * address (`?link=…`, parsed by `dataLinkIn` in `ComposePage`), which needs
 * its summary — and its checks — before it may attach anything.
 */

export interface AddressLink {
  link: DataLink;
  /** For a `player_game`, the game whose box score holds the line. */
  gameId: number | null;
}

export interface AttachmentPickerProps {
  mediator: ComposeMediator;
  /** A link from the address, to check and attach on arrival. */
  prefill?: AddressLink | null;
}

type Choice = "game" | "playerGame" | "career";

const CHOICES: readonly { choice: Choice; label: string }[] = [
  { choice: "game", label: "Game result" },
  { choice: "playerGame", label: "Player's game" },
  { choice: "career", label: "Player career" },
];

/** How long typing has to pause before the player search asks. */
const SEARCH_DEBOUNCE_MS = 250;

/** Fewer letters than this match too much to be worth a request. */
const SEARCH_MIN_LENGTH = 2;

export function AttachmentPicker({
  mediator,
  prefill = null,
}: AttachmentPickerProps) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const panelId = useId();
  // Found by id rather than by ref: the shared `Button` (React 18) does not
  // forward a ref, and its `id` is passed through to the native button.
  const toggleId = useId();
  const firstChoiceId = useId();

  // Written before the link is sent, and read while rendering what the
  // mediator then publishes, so the summary has its words on the very render
  // the link appears in. A ref rather than state for exactly that ordering.
  const summaries = useRef(new Map<string, string>());

  useEffect(() => {
    if (open) document.getElementById(firstChoiceId)?.focus();
  }, [open, firstChoiceId]);

  function close(): void {
    setOpen(false);
    setChoice(null);
    document.getElementById(toggleId)?.focus();
  }

  function attach(link: DataLink, summary: string): void {
    summaries.current.set(dataLinkKey(link), summary);
    mediator.send("attachment", { kind: "link-attached", link });
    close();
  }

  // ---------------------------------------------- the pre-filled address

  const check = useQuery({
    queryKey: [
      "compose",
      "address-link",
      prefill === null ? null : dataLinkKey(prefill.link),
      prefill?.gameId ?? null,
    ],
    queryFn: () => {
      if (prefill === null)
        throw new Error("The address check ran with no link.");
      return checkAddressLink(prefill.link, prefill.gameId);
    },
    enabled: prefill !== null,
    // A 404 is an answer, not a blip: say so at once rather than retrying it.
    retry: false,
    staleTime: Infinity,
  });
  const prefillApplied = useRef(false);

  useEffect(() => {
    // Once per mount: StrictMode re-runs the effect, and a second send would
    // put a second snapshot on the undo history.
    if (prefill === null || prefillApplied.current) return;
    if (check.data?.ok !== true) return;
    prefillApplied.current = true;
    summaries.current.set(dataLinkKey(prefill.link), check.data.summary);
    mediator.send("attachment", { kind: "link-attached", link: prefill.link });
  }, [prefill, check.data, mediator]);

  let addressNote: ReactNode = null;
  if (prefill !== null && draft.dataLink === null) {
    if (check.isPending) {
      addressNote = <StatusLine>Loading the stats in this link…</StatusLine>;
    } else if (check.data?.ok === false) {
      addressNote = <StatusLine>{check.data.note}</StatusLine>;
    }
  }

  // ------------------------------------------------------------ render

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape" || !open) return;
    // Handled here, so a dialog the composer sits in does not close as well.
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  const link = draft.dataLink;

  return (
    <div className={styles.picker} onKeyDown={handleKeyDown}>
      {addressNote}

      {link === null ? null : (
        <section className={styles.summary} aria-label="Attached stats">
          <p className={styles.summaryText}>
            {summaries.current.get(dataLinkKey(link)) ?? describeBareLink(link)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              mediator.send("attachment", { kind: "link-removed" });
            }}
          >
            Remove attached stats
          </Button>
        </section>
      )}

      <div>
        <Button
          id={toggleId}
          type="button"
          variant="secondary"
          size="md"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => {
            if (open) close();
            else setOpen(true);
          }}
        >
          Attach stats
        </Button>
      </div>

      {open ? (
        <div
          id={panelId}
          className={styles.panel}
          role="group"
          aria-label="Attach stats"
        >
          <div className={styles.choices}>
            {CHOICES.map((entry, index) => (
              <Button
                key={entry.choice}
                id={index === 0 ? firstChoiceId : undefined}
                type="button"
                variant="secondary"
                size="md"
                aria-pressed={choice === entry.choice}
                onClick={() => {
                  setChoice(entry.choice);
                }}
              >
                {entry.label}
              </Button>
            ))}
          </div>

          {choice === "game" ? (
            <GameFinder
              onGame={(game, label) => {
                attach({ type: "game_final", ref_id: game.id }, label);
              }}
            />
          ) : null}
          {choice === "playerGame" ? (
            <PlayerGamePicker
              onLine={(lineId, summary) => {
                attach({ type: "player_game", ref_id: lineId }, summary);
              }}
            />
          ) : null}
          {choice === "career" ? (
            <CareerPicker
              onCareer={(playerId, scope, summary) => {
                attach(
                  { type: "player_career", ref_id: playerId, scope },
                  summary,
                );
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ the parts

/** A list of full-width option buttons, or nothing when there are none. */
function OptionList({
  options,
}: {
  options: readonly {
    key: string | number;
    label: string;
    onChoose: () => void;
  }[];
}) {
  if (options.length === 0) return null;
  return (
    <ul className={styles.list}>
      {options.map((option) => (
        <li key={option.key}>
          <Button
            type="button"
            variant="ghost"
            size="md"
            className={styles.option}
            onClick={option.onChoose}
          >
            {option.label}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * A line that takes the focus when it appears, for a step that replaces the
 * control the user just pressed: without it, focus would fall to the page.
 */
function StepLead({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p ref={ref} tabIndex={-1} className={styles.lead}>
      {children}
    </p>
  );
}

function teamName(teams: Map<number, TeamOut>, id: number): string {
  return teams.get(id)?.name ?? `Team ${id}`;
}

/**
 * Narrow to one team's season and choose a completed game from it. Shared by
 * Game result and Player's game, which differ only in what choosing does.
 */
function GameFinder({
  onGame,
}: {
  onGame: (game: GameOut, label: string) => void;
}) {
  const teamFieldId = useId();
  const seasonFieldId = useId();
  const [teamId, setTeamId] = useState("");
  const [season, setSeason] = useState("");

  const teams = useQuery({
    queryKey: ["compose", "teams"],
    queryFn: fetchTeams,
  });
  const seasons = useQuery({
    queryKey: ["compose", "seasons"],
    queryFn: fetchSeasons,
  });
  const games = useQuery({
    queryKey: ["compose", "team-games", teamId, season],
    queryFn: () => fetchTeamGames(Number(teamId), season),
    enabled: teamId !== "" && season !== "",
  });

  const teamsById = new Map((teams.data ?? []).map((team) => [team.id, team]));
  const sortedTeams = [...(teams.data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const completed = (games.data ?? []).filter(isCompleted);

  return (
    <div className={styles.step}>
      {teams.isError || seasons.isError ? (
        <InlineAlert>
          We could not load the teams and seasons just now. Please try again.
        </InlineAlert>
      ) : null}

      <div className={styles.fields}>
        <Field id={teamFieldId} label="Team">
          <select
            {...describeField(teamFieldId)}
            value={teamId}
            onChange={(event) => {
              setTeamId(event.target.value);
            }}
          >
            <option value="">Choose a team</option>
            {sortedTeams.map((team) => (
              <option key={team.id} value={String(team.id)}>
                {team.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={seasonFieldId} label="Season">
          <select
            {...describeField(seasonFieldId)}
            value={season}
            onChange={(event) => {
              setSeason(event.target.value);
            }}
          >
            <option value="">Choose a season</option>
            {(seasons.data ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {games.isFetching && games.data === undefined ? (
        <StatusLine>Loading games…</StatusLine>
      ) : null}
      {games.isError ? (
        <InlineAlert>
          We could not load those games just now. Please try again.
        </InlineAlert>
      ) : null}
      {games.isSuccess && completed.length === 0 ? (
        <p className={styles.lead}>
          No completed games for that team in that season.
        </p>
      ) : null}

      <OptionList
        options={completed.map((game) => {
          const label = describeGame({
            homeName: teamName(teamsById, game.home_team_id),
            awayName: teamName(teamsById, game.away_team_id),
            home_score: game.home_score,
            away_score: game.away_score,
            date: game.date,
          });
          return {
            key: game.id,
            label,
            onChoose: () => {
              onGame(game, label);
            },
          };
        })}
      />
    </div>
  );
}

/** Choose a game, then a player who played in it. */
function PlayerGamePicker({
  onLine,
}: {
  onLine: (lineId: number, summary: string) => void;
}) {
  const [game, setGame] = useState<{ id: number; label: string } | null>(null);

  const detail = useQuery({
    queryKey: ["compose", "game", game?.id ?? null],
    queryFn: () => {
      if (game === null) throw new Error("The box score ran with no game.");
      return fetchGameDetail(game.id);
    },
    enabled: game !== null,
  });

  if (game === null) {
    return (
      <GameFinder
        onGame={(chosen, label) => {
          setGame({ id: chosen.id, label });
        }}
      />
    );
  }

  const lines = detail.data === undefined ? [] : playedLines(detail.data);

  return (
    <div className={styles.step}>
      <StepLead>Players who played in {game.label}</StepLead>
      {detail.isPending ? (
        <StatusLine>Loading the box score…</StatusLine>
      ) : null}
      {detail.isError ? (
        <InlineAlert>
          We could not load that game&apos;s box score just now. Please try
          again.
        </InlineAlert>
      ) : null}
      {detail.isSuccess && lines.length === 0 ? (
        <p className={styles.lead}>
          Nobody has a played line in that game yet.
        </p>
      ) : null}

      <OptionList
        options={lines.map((entry) => ({
          key: entry.line.line_id,
          label: `${playerName(entry.line)} · ${entry.team.abbreviation} · ${entry.line.points} pts`,
          onChoose: () => {
            if (detail.data === undefined) return;
            onLine(entry.line.line_id, describeLine(detail.data, entry));
          },
        }))}
      />

      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setGame(null);
          }}
        >
          Choose another game
        </Button>
      </div>
    </div>
  );
}

/** Search players by name, choose one, then a scope with games in it. */
function CareerPicker({
  onCareer,
}: {
  onCareer: (
    playerId: number,
    scope: "regular" | "playoffs",
    summary: string,
  ) => void;
}) {
  const searchId = useId();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [player, setPlayer] = useState<PlayerListItemOut | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);

  const results = useQuery({
    queryKey: ["compose", "players", query],
    queryFn: () => searchPlayers(query),
    enabled: query.length >= SEARCH_MIN_LENGTH,
  });
  const detail = useQuery({
    queryKey: ["compose", "player", player?.id ?? null],
    queryFn: () => {
      if (player === null) throw new Error("The career ran with no player.");
      return fetchPlayerDetail(player.id);
    },
    enabled: player !== null,
  });

  if (player !== null) {
    const scopes = detail.data === undefined ? [] : careerScopes(detail.data);
    return (
      <div className={styles.step}>
        <StepLead>{playerName(player)}: choose the part of the career</StepLead>
        {detail.isPending ? <StatusLine>Loading the career…</StatusLine> : null}
        {detail.isError ? (
          <InlineAlert>
            We could not load that player&apos;s career just now. Please try
            again.
          </InlineAlert>
        ) : null}
        {detail.isSuccess && scopes.length === 0 ? (
          <p className={styles.lead}>
            {playerName(player)} has no regular-season or playoff games to
            attach.
          </p>
        ) : null}

        <OptionList
          options={scopes.map((scope) => ({
            key: scope,
            label: `${scopeName(scope)} · ${gamesPlayed(
              detail.data === undefined
                ? 0
                : careerLine(detail.data, scope).games_played,
            )}`,
            onChoose: () => {
              if (detail.data === undefined) return;
              onCareer(player.id, scope, describeCareer(detail.data, scope));
            },
          }))}
        />

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPlayer(null);
            }}
          >
            Choose another player
          </Button>
        </div>
      </div>
    );
  }

  const searching = query.length >= SEARCH_MIN_LENGTH;

  return (
    <div className={styles.step}>
      <Field id={searchId} label="Search players by name">
        <input
          {...describeField(searchId)}
          className={styles.search}
          type="search"
          name="player-search"
          autoComplete="off"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
          }}
        />
      </Field>

      {searching && results.isPending ? (
        <StatusLine>Searching…</StatusLine>
      ) : null}
      {searching && results.isError ? (
        <InlineAlert>
          We could not search players just now. Please try again.
        </InlineAlert>
      ) : null}
      {searching && results.isSuccess && results.data.length === 0 ? (
        <p className={styles.lead}>No players match &ldquo;{query}&rdquo;.</p>
      ) : null}

      <OptionList
        options={(searching ? (results.data ?? []) : []).map((found) => ({
          key: found.id,
          label: [
            playerName(found),
            found.latest_team_abbreviation,
            found.first_season === null
              ? null
              : `${found.first_season}–${found.last_season ?? ""}`,
          ]
            .filter((part) => part !== null && part !== "")
            .join(" · "),
          onChoose: () => {
            setPlayer(found);
          },
        }))}
      />
    </div>
  );
}
