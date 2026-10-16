import { useId, useState, type KeyboardEvent } from "react";

import { Field, describeField } from "../../components/FormField";
import type { TeamOut } from "./api";
import styles from "./Stats.module.css";

const INPUT_ID = "stats-team-search";

export interface TeamSearchProps {
  /** `GET /events/teams`, matched on the client; `undefined` while loading. */
  teams: TeamOut[] | undefined;
  /** The team in the address (`?team=`), or `null`. */
  selectedId: number | null;
  onChoose: (team: TeamOut) => void;
  /** The bar was emptied: back to the league view. */
  onClear: () => void;
}

/** Case-insensitive, on the team's name or its abbreviation. */
function matches(teams: TeamOut[], text: string): TeamOut[] {
  const needle = text.trim().toLowerCase();
  if (needle === "") return [];
  return teams.filter(
    (team) =>
      team.name.toLowerCase().includes(needle) ||
      team.abbreviation.toLowerCase().includes(needle),
  );
}

/**
 * The Seasons tab's small team search bar: an ARIA 1.2 combobox (an input
 * with `role="combobox"` controlling a `listbox`), matching the thirty teams
 * of `GET /events/teams` as the user types. It asks the API nothing itself.
 *
 * Focus never leaves the input: the arrow keys move `aria-activedescendant`
 * through the options, Enter chooses the active one, Escape closes the list
 * without choosing. Options take `mousedown` with `preventDefault`, so a click
 * chooses before the input's blur would close the list.
 */
export function TeamSearch({
  teams,
  selectedId,
  onChoose,
  onClear,
}: TeamSearchProps) {
  const listId = useId();
  const optionId = useId();
  const selectedName =
    selectedId === null
      ? ""
      : (teams?.find((team) => team.id === selectedId)?.name ?? "");

  const [text, setText] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // The bar shows the chosen team's name, including after Back or a link
  // changes `?team=`, or once the teams arrive for a page opened at `?team=`.
  // Adjusted during render, not in an effect, so it never shows a stale name.
  const [shownFor, setShownFor] = useState(selectedName);
  if (shownFor !== selectedName) {
    setShownFor(selectedName);
    setText(selectedName);
  }

  const options = matches(teams ?? [], text);
  const expanded = open && options.length > 0;

  function choose(team: TeamOut): void {
    setText(team.name);
    setOpen(false);
    setActive(-1);
    onChoose(team);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (options.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) =>
        current === -1 && step === -1
          ? options.length - 1
          : (current + step + options.length) % options.length,
      );
    } else if (event.key === "Enter") {
      if (expanded && active >= 0 && active < options.length) {
        event.preventDefault();
        choose(options[active]);
      }
    } else if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        setOpen(false);
        setActive(-1);
      }
    }
  }

  return (
    <div className={styles.combobox}>
      <Field
        id={INPUT_ID}
        label="Team"
        hintText="Type a team’s name or abbreviation, for example Celtics or BOS."
      >
        <input
          {...describeField(INPUT_ID, { hint: true })}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={
            expanded && active >= 0 ? `${optionId}-${active}` : undefined
          }
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            setOpen(true);
            setActive(-1);
            if (value.trim() === "" && selectedId !== null) onClear();
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
        />
      </Field>
      {!expanded ? null : (
        <ul
          id={listId}
          role="listbox"
          aria-label="Teams"
          className={styles.options}
        >
          {options.map((team, index) => (
            <li
              key={team.id}
              id={`${optionId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={styles.option}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(team)}
            >
              {team.name}{" "}
              <span className={styles.muted}>{team.abbreviation}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
