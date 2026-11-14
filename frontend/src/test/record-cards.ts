/**
 * FRONTEND-042: readers for a Historical record card's top three, and for
 * the style an element takes from the stylesheets (jsdom computes no CSS,
 * `verification.md` §2a).
 *
 * **Styles.** `styleOf(element, property)` resolves a property the way the
 * cascade would for the few properties these tests read: the element's own
 * matching rules first (the last matching declaration in source order), then
 * its parent's, and so on up the tree (inheritance). A rule matches when its
 * selector, with each module class translated to the class the module
 * generates, matches the element (`Element.matches`); so `.holder .name`,
 * `.section strong` and `.table tbody th.name` all count where they apply,
 * and a rule inside an at-rule (a media query jsdom cannot evaluate) does
 * not. The stylesheets read are `styles/base.css` and every module under
 * `components/` and `features/stats/`. With no rule, `strong`, `b` and `th`
 * take the browser's bold.
 *
 * `ownStyle(element, property)` is the same without inheritance, for the
 * properties that do not inherit (`overflow`, `text-overflow`).
 *
 * Vitest does not process CSS here: a module's default export answers any
 * name with `_<name>_<hash of the file>`, so a selector's classes translate
 * through that module's export.
 */
import { parseCss, readSrcFile, selectors, type CssBlock } from "./css";

const MODULES = import.meta.glob<{ default: Record<string, string> }>(
  ["../components/**/*.module.css", "../features/stats/*.module.css"],
  { eager: true },
);

interface Rule {
  selector: string;
  declarations: CssBlock["declarations"];
}

let RULES: Rule[] | null = null;

/** Style rules outside every at-rule but `@layer`, in source order. */
function styleRules(blocks: CssBlock[]): CssBlock[] {
  return blocks.flatMap((block) =>
    /^@layer\b/i.test(block.prelude)
      ? styleRules(block.children)
      : block.prelude.startsWith("@")
        ? []
        : [block],
  );
}

function rules(): Rule[] {
  if (RULES !== null) return RULES;
  const found: Rule[] = [];
  for (const block of styleRules(parseCss(readSrcFile("styles/base.css"))))
    for (const selector of selectors(block))
      found.push({ selector, declarations: block.declarations });
  for (const [key, module] of Object.entries(MODULES)) {
    const path = key.replace(/^\.\.\//, "");
    for (const block of styleRules(parseCss(readSrcFile(path))))
      for (const selector of selectors(block)) {
        if (selector.includes("::")) continue;
        const translated = selector.replace(
          /\.(-?[_a-zA-Z][\w-]*)/g,
          (_, name: string) => `.${module.default[name]}`,
        );
        found.push({ selector: translated, declarations: block.declarations });
      }
  }
  RULES = found;
  return found;
}

function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

const TAG_BOLD = new Set(["STRONG", "B", "TH"]);

/** The value `element`'s own matching rules give `property`, or undefined. */
export function ownStyle(
  element: Element,
  property: string,
): string | undefined {
  let value: string | undefined;
  for (const rule of rules()) {
    if (!matches(element, rule.selector)) continue;
    for (const declaration of rule.declarations)
      if (declaration.property === property)
        value = declaration.value.trim().toLowerCase().replace(/\s+/g, " ");
  }
  if (
    value === undefined &&
    property === "font-weight" &&
    TAG_BOLD.has(element.tagName)
  )
    return "bold";
  return value;
}

/** `property` as `element` inherits it: its own rule, else its parent's. */
export function styleOf(
  element: Element,
  property: string,
): string | undefined {
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    const value = ownStyle(node, property);
    if (value !== undefined) return value;
  }
  return undefined;
}

export const SEMIBOLD = ["var(--font-weight-semibold)", "600"];
export const REGULAR = ["var(--font-weight-regular)", "400", "normal"];

// ------------------------------------------------------------- the entries

/** Inside the global `.visually-hidden` (text for screen readers only). */
function screenReaderOnly(node: Node, root: Element): boolean {
  for (
    let element = node.parentElement;
    element !== null && element !== root.parentElement;
    element = element.parentElement
  )
    if (element.classList.contains("visually-hidden")) return true;
  return false;
}

/**
 * The first text node under `root`, outside text for screen readers only,
 * whose text (trimmed) is `text`, or starts with `text` and a space (a value
 * followed by its unit in the same node).
 */
export function textNode(root: Element, text: string): Text | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const data = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (
      (data === text || data.startsWith(`${text} `)) &&
      !screenReaderOnly(node, root)
    )
      return node as Text;
  }
  return null;
}

/** The first text node under `root` whose text contains `text`. */
export function textNodeContaining(root: Element, text: string): Text | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
    if (
      (node.textContent ?? "").replace(/\s+/g, " ").includes(text) &&
      !screenReaderOnly(node, root)
    )
      return node as Text;
  return null;
}

/** The element holding `text` in `root`, failing the test when there is none. */
export function holding(root: Element, text: string): HTMLElement {
  const node = textNode(root, text);
  if (node === null || node.parentElement === null)
    throw new Error(
      `no text "${text}" in: ${(root.textContent ?? "").replace(/\s+/g, " ")}`,
    );
  return node.parentElement;
}

/** The innermost element containing every one of `nodes`. */
export function commonAncestor(...nodes: Node[]): Element {
  let candidate: Element | null = nodes[0].parentElement;
  while (
    candidate !== null &&
    !nodes.every((node) => candidate?.contains(node))
  )
    candidate = candidate.parentElement;
  if (candidate === null) throw new Error("no common ancestor");
  return candidate;
}

/** The elements from `element` up to and including `stop`. */
export function chain(element: Element, stop: Element): Element[] {
  const found: Element[] = [];
  for (
    let node: Element | null = element;
    node !== null;
    node = node.parentElement
  ) {
    found.push(node);
    if (node === stop) break;
  }
  return found;
}
