/**
 * The table contract every data table owes (`FRONTEND-009` criterion 13,
 * `accessibility.md`), as one reader the stats, player and game pages' tests
 * share: a non-empty `<caption>`, a `scope` on every header cell, and its own
 * scroll container — a named `role="region"` with `tabIndex` 0 (so a keyboard
 * user can scroll it sideways on a phone) that holds that table and no other.
 *
 * jsdom measures no layout, so whether the container really scrolls at 360 px
 * is the static CSS test's (`overflow-x: auto` on disk) and the browser
 * checklist's. What jsdom can show is that the container exists, per table.
 */

const SCOPES = ["col", "row", "colgroup", "rowgroup"];

function norm(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** The table's own scroll region, or `null`. */
export function scrollRegionOf(table: HTMLTableElement): HTMLElement | null {
  const region = table.parentElement?.closest<HTMLElement>('[role="region"]');
  return region ?? null;
}

function regionName(region: HTMLElement): string {
  const label = norm(region.getAttribute("aria-label"));
  if (label !== "") return label;
  const ids = (region.getAttribute("aria-labelledby") ?? "").split(/\s+/);
  return norm(
    ids
      .map((id) => (id === "" ? "" : document.getElementById(id)?.textContent))
      .join(" "),
  );
}

/** Every way the tables under `root` break the contract, as readable lines. */
export function tableProblems(root: HTMLElement): string[] {
  const tables = [...root.querySelectorAll("table")];
  const problems: string[] = [];
  tables.forEach((table, index) => {
    const caption = table.querySelector(":scope > caption");
    const name = norm(caption?.textContent) || `table ${index + 1}`;
    if (caption === null || norm(caption.textContent) === "")
      problems.push(`${name}: no caption`);
    for (const th of table.querySelectorAll("th")) {
      if (!SCOPES.includes(th.getAttribute("scope") ?? ""))
        problems.push(`${name}: <th>${norm(th.textContent)}</th> has no scope`);
    }
    const region = scrollRegionOf(table);
    if (region === null) {
      problems.push(`${name}: not inside a role="region" scroll container`);
      return;
    }
    if (region.tabIndex !== 0)
      problems.push(`${name}: its scroll region is not tabIndex 0`);
    if (regionName(region) === "")
      problems.push(`${name}: its scroll region has no accessible name`);
    const shared = tables.filter(
      (other) => other !== table && region.contains(other),
    );
    if (shared.length > 0)
      problems.push(`${name}: its scroll region holds another table too`);
  });
  return problems;
}

/** The tables under `root` whose caption matches `caption`. */
export function tablesCaptioned(
  root: HTMLElement,
  caption: RegExp,
): HTMLTableElement[] {
  return [...root.querySelectorAll("table")].filter((table) =>
    caption.test(norm(table.querySelector(":scope > caption")?.textContent)),
  );
}

/** One table by caption; throws unless exactly one matches. */
export function tableCaptioned(
  root: HTMLElement,
  caption: RegExp,
): HTMLTableElement {
  const found = tablesCaptioned(root, caption);
  if (found.length !== 1)
    throw new Error(`expected one table captioned ${caption}, found ${found.length}`);
  return found[0];
}

/** The text of each column header of `table`, whitespace collapsed. */
export function columnHeaders(table: HTMLTableElement): string[] {
  const head = table.tHead ?? table;
  return [...head.querySelectorAll('th[scope="col"]')].map((th) =>
    norm(th.textContent),
  );
}

/** The body rows of `table` (not the header row). */
export function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return [...table.tBodies].flatMap((body) => [...body.rows]);
}

/** A row's text with a space between text nodes. */
export function rowText(element: Element): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.textContent ?? "");
  }
  return norm(parts.join(" "));
}

/** `n` (as text) not part of a longer number. */
export function figure(n: string | number): RegExp {
  const escaped = String(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d])`);
}
