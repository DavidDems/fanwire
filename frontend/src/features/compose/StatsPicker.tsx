import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  gameDetailQuery,
  playerDetailQuery,
  seasonsQuery,
} from "../../api/stats";
import { PlayerResults } from "../../components/stats-nav/PlayerResults";
import {
  NoSeason,
  SeasonSelect,
} from "../../components/stats-nav/SeasonSelect";
import { StatsNavigator } from "../../components/stats-nav/StatsNavigator";
import {
  ColumnHeader,
  ScrollTable,
} from "../../components/stats-nav/ScrollTable";
import type {
  StatsLevel,
  StatsNavAdapter,
} from "../../components/stats-nav/types";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { SearchInput } from "../../components/ui/SearchInput";
import { SegmentedTabs } from "../../components/ui/SegmentedTabs";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  careerLine,
  describeCareer,
  describeGameDetail,
  describeLine,
  gamesPlayed,
  isCompleted,
  playedLines,
  playerName,
  scopeName,
} from "./attachmentReads";
import { dataLinkKey, type DataLink } from "./dataLink";
import styles from "./StatsPicker.module.css";

type Selection = { link: DataLink; summary: string };
const TABS = [
  { id: "seasons", label: "Seasons" },
  { id: "players", label: "Players" },
];

/** A private navigation stack and one pending choice, discarded on dismissal. */
export function StatsPicker({
  onAttach,
  onClose,
}: {
  onAttach(link: DataLink, summary: string): void;
  onClose(): void;
}) {
  const seasons = useQuery(seasonsQuery());
  const [tab, setTab] = useState("seasons");
  const [picked, setPicked] = useState<string | null>(null);
  const [path, setPath] = useState<StatsLevel[] | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const season = picked ?? seasons.data?.[0] ?? null;
  const stack: StatsLevel[] =
    path ??
    (tab === "players"
      ? [{ kind: "players" }]
      : season === null
        ? []
        : [{ kind: "season", season, conf: "all" }]);
  const choose = (link: DataLink, summary: string) =>
    setSelection({ link, summary });
  const adapter: StatsNavAdapter = {
    gameLink: (_id, words) => words,
    playerLink: (_id, words) => words,
  };
  return (
    <div className={styles.picker}>
      <SegmentedTabs
        label="Stats source"
        tabs={TABS}
        value={tab}
        onChange={(value) => {
          setTab(value);
          setPath(null);
        }}
      >
        <div className={styles.levels}>
          {tab === "seasons" ? (
            <SeasonSelect
              season={season}
              options={seasons.data ?? []}
              onPick={(value) => {
                setPicked(value);
                setPath([{ kind: "season", season: value, conf: "all" }]);
              }}
            />
          ) : null}
          {stack.length === 0 ? (
            <NoSeason seasons={seasons} />
          ) : (
            <StatsNavigator
              stack={stack}
              adapter={adapter}
              selectMode
              open={(level) => setPath([...stack, level])}
              replace={(level) => setPath([...stack.slice(0, -1), level])}
              pop={(depth) => setPath(stack.slice(0, depth))}
              levelViews={{
                name: (level) =>
                  level.kind === "game" ? (
                    <GameName id={level.gameId} />
                  ) : level.kind === "player" ? (
                    <PlayerName id={level.playerId} />
                  ) : (
                    "Players"
                  ),
                view: (level, { open }) =>
                  level.kind === "game" ? (
                    <GameChoice
                      id={level.gameId}
                      selection={selection}
                      choose={choose}
                    />
                  ) : level.kind === "player" ? (
                    <CareerChoice
                      id={level.playerId}
                      selection={selection}
                      choose={choose}
                    />
                  ) : level.kind === "players" ? (
                    <Players
                      text={text}
                      q={q}
                      setText={setText}
                      adapter={{
                        ...adapter,
                        playerLink: (playerId, words) => (
                          <button
                            type="button"
                            className={styles.level}
                            onClick={() => open({ kind: "player", playerId })}
                          >
                            {words}
                          </button>
                        ),
                      }}
                    />
                  ) : null,
              }}
            />
          )}
        </div>
      </SegmentedTabs>
      <div className={styles.footer}>
        <StatusLine>
          {selection === null
            ? "Nothing selected"
            : `Selected: ${selection.summary}`}
        </StatusLine>
        <div className={styles.buttons}>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={selection === null}
            onClick={() => {
              if (selection) onAttach(selection.link, selection.summary);
            }}
          >
            Select
          </Button>
        </div>
      </div>
    </div>
  );
}

function GameName({ id }: { id: number }) {
  const game = useQuery(gameDetailQuery(id));
  return (
    <>
      {game.data
        ? `${game.data.away_team.name} at ${game.data.home_team.name}`
        : "Game"}
    </>
  );
}
function PlayerName({ id }: { id: number }) {
  const player = useQuery(playerDetailQuery(id));
  return <>{player.data ? playerName(player.data) : "Player"}</>;
}
type ChoiceProps = {
  id: number;
  selection: Selection | null;
  choose(link: DataLink, summary: string): void;
};
function Radio({
  link,
  summary,
  children,
  selection,
  choose,
  name,
  label,
}: Omit<ChoiceProps, "id"> & {
  link: DataLink;
  summary: string;
  children: ReactNode;
  name: string;
  label?: string;
}) {
  return (
    <label className={styles.choice}>
      <input
        type="radio"
        aria-label={label}
        name={name}
        checked={
          selection !== null &&
          dataLinkKey(selection.link) === dataLinkKey(link)
        }
        onChange={() => choose(link, summary)}
      />
      {children}
    </label>
  );
}
function GameChoice({ id, selection, choose }: ChoiceProps) {
  const game = useQuery(gameDetailQuery(id));
  const group = useId();
  if (game.isPending) return <StatusLine>Loading the game…</StatusLine>;
  if (game.isError)
    return (
      <InlineAlert>
        We could not load this game just now. Please try again.
      </InlineAlert>
    );
  if (game.data === null) return <EmptyState>Game not found.</EmptyState>;
  const data = game.data;
  const title = `${data.away_team.name} at ${data.home_team.name}`;
  const final = `Final score · ${describeGameDetail(data)}`;
  return (
    <fieldset className={styles.group}>
      <legend className="visually-hidden">{title}</legend>
      {isCompleted(data) ? (
        <Radio
          link={{ type: "game_final", ref_id: id }}
          summary={describeGameDetail(data)}
          selection={selection}
          choose={choose}
          name={group}
        >
          {final}
        </Radio>
      ) : (
        <p>{final}</p>
      )}
      <ScrollTable caption="Box score">
        <thead>
          <tr>
            <ColumnHeader label="Player" name />
            <ColumnHeader label="Team" name />
            <ColumnHeader label="MIN" title="Minutes" />
            <ColumnHeader label="PTS" title="Points" />
            <ColumnHeader label="REB" title="Rebounds" />
            <ColumnHeader label="AST" title="Assists" />
          </tr>
        </thead>
        <tbody>
          {playedLines(data).map((entry) => (
            <tr key={entry.line.line_id}>
              <th scope="row">
                <Radio
                  link={{ type: "player_game", ref_id: entry.line.line_id }}
                  summary={describeLine(data, entry)}
                  selection={selection}
                  choose={choose}
                  name={group}
                  label={`${playerName(entry.line)} ${entry.team.name} ${Math.floor(entry.line.seconds_played / 60)} minutes ${entry.line.points} points ${entry.line.rebounds} rebounds ${entry.line.assists} assists`}
                >
                  {playerName(entry.line)}
                </Radio>
              </th>
              <td>{entry.team.abbreviation}</td>
              <td>
                {Math.floor(entry.line.seconds_played / 60)}:
                {String(entry.line.seconds_played % 60).padStart(2, "0")}
              </td>
              <td>{entry.line.points}</td>
              <td>{entry.line.rebounds}</td>
              <td>{entry.line.assists}</td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    </fieldset>
  );
}
function CareerChoice({ id, selection, choose }: ChoiceProps) {
  const player = useQuery(playerDetailQuery(id));
  const group = useId();
  if (player.isPending) return <StatusLine>Loading the player…</StatusLine>;
  if (player.isError)
    return (
      <InlineAlert>
        We could not load this player just now. Please try again.
      </InlineAlert>
    );
  if (player.data === null) return <EmptyState>Player not found.</EmptyState>;
  const data = player.data;
  return (
    <fieldset className={styles.group}>
      <legend className="visually-hidden">{playerName(data)}</legend>
      {(["regular", "playoffs"] as const).map((scope) => {
        const line = careerLine(data, scope);
        const words = `${scopeName(scope)} · ${gamesPlayed(line.games_played)} · ${line.points.toLocaleString("en-US")} career points`;
        return line.games_played > 0 ? (
          <Radio
            key={scope}
            link={{ type: "player_career", ref_id: id, scope }}
            summary={describeCareer(data, scope)}
            selection={selection}
            choose={choose}
            name={group}
          >
            {words}
          </Radio>
        ) : (
          <p key={scope}>{words}</p>
        );
      })}
    </fieldset>
  );
}
function Players({
  adapter,
  text,
  q,
  setText,
}: {
  adapter: StatsNavAdapter;
  text: string;
  q: string;
  setText(text: string): void;
}) {
  const id = useId();
  return (
    <>
      <SearchInput
        id={id}
        label="Search players"
        autoComplete="off"
        maxLength={100}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {q.length < 2 ? null : <PlayerResults q={q} adapter={adapter} />}
    </>
  );
}
