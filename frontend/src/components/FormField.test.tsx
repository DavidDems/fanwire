/**
 * FRONTEND-053: `Field`'s layouts (`components-map-posts.md` §5, "`Field` owns
 * its own layout").
 *
 * The interface this file pins:
 *
 *     <Field id label hintText error layout?: "stack" | "checkbox" | "row">
 *
 * - **stack** (the default): exactly today's markup, a root carrying only the
 *   `field` class, then the label, the control, the hint, the error. The auth
 *   pages' own pin of that order is `auth/form-field.test.tsx`, untouched.
 * - **checkbox**: the root adds `checkbox`; the box comes first, as a direct
 *   child of the root, then the label, then the hint, then the error, in DOM
 *   order, so reading and tab order match the screen.
 * - **row**: the root adds `row`; stack's DOM order, with the control and one
 *   trailing action side by side under the label.
 *
 * jsdom applies no CSS, so the rules are read from `FormField.module.css` on
 * disk. On Vitest 4 `styles.x` is a hashed name even for an undefined class,
 * so each class the markup tests assert is confirmed to exist on disk too.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  allBlocks,
  isAtRule,
  parseCss,
  readSrcFile,
  selectors,
  type CssBlock,
} from "../test/css";
import { declared, moduleCssViolations } from "../test/module-css";
import { Field, describeField } from "./FormField";
import styles from "./FormField.module.css";

const ID = "test-field";
const LABEL = "Email me about new posts";
const HINT = "You can change this any time.";
const ERROR = "That did not save.";

const FILE = "components/FormField.module.css";

type Layout = "stack" | "checkbox" | "row";

function renderField(layout: Layout | undefined, type = "checkbox") {
  return render(
    <Field
      id={ID}
      label={LABEL}
      hintText={HINT}
      error={ERROR}
      {...(layout === undefined ? {} : { layout })}
    >
      <input {...describeField(ID, { error: ERROR, hint: true })} type={type} />
    </Field>,
  );
}

/** The root's element children, as short names in DOM order. */
function order(root: HTMLElement): string[] {
  return [...root.children].map((child) => {
    if (child.tagName === "LABEL") return "label";
    if (child.id === `${ID}-hint`) return "hint";
    if (child.id === `${ID}-error`) return "error";
    if (child.tagName === "INPUT") return "control";
    if (child.tagName === "BUTTON") return "action";
    return child.tagName.toLowerCase();
  });
}

function rootOf(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("no Field root");
  return root;
}

function rules(): CssBlock[] {
  return allBlocks(parseCss(readSrcFile(FILE))).filter(
    (block) => !isAtRule(block),
  );
}

/** Rules with at least one selector matching `pattern`. */
function rulesMatching(pattern: RegExp): CssBlock[] {
  return rules().filter((block) =>
    selectors(block).some((selector) => pattern.test(selector)),
  );
}

/** The last value `property` takes across the rules matching `pattern`. */
function valueFor(pattern: RegExp, property: string): string | undefined {
  let found: string | undefined;
  for (const block of rulesMatching(pattern)) {
    const value = declared(block, property);
    if (value !== undefined) found = value;
  }
  return found;
}

describe("Field's stack layout (the default)", () => {
  it.each([undefined, "stack"] as const)(
    "with layout %s, renders today's markup: the field class only, label, control, hint, error",
    (layout) => {
      const { container } = renderField(layout, "text");
      const root = rootOf(container);

      expect(root.tagName).toBe("DIV");
      expect(root.className).toBe(styles.field);
      expect(order(root)).toEqual(["label", "control", "hint", "error"]);
    },
  );
});

describe("Field's checkbox layout", () => {
  it("adds the checkbox class to the field root", () => {
    const { container } = renderField("checkbox");
    const root = rootOf(container);

    expect(root).toHaveClass(styles.field, styles.checkbox);
    expect(root).not.toHaveClass(styles.row);
  });

  it("puts the box first, as a direct child of the root, then the label, the hint, the error", () => {
    const { container } = renderField("checkbox");
    const root = rootOf(container);
    const box = screen.getByRole("checkbox", { name: LABEL });

    expect(box.parentElement).toBe(root);
    expect(order(root)).toEqual(["control", "label", "hint", "error"]);
  });

  it("keeps the ids, the label's for, the name and the description", () => {
    renderField("checkbox");
    const box = screen.getByRole("checkbox", { name: LABEL });

    expect(box).toHaveAttribute("id", ID);
    expect(document.querySelector("label")).toHaveAttribute("for", ID);
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAttribute("aria-describedby", `${ID}-hint ${ID}-error`);
    expect(box).toHaveAccessibleName(LABEL);
    expect(box).toHaveAccessibleDescription(`${HINT} ${ERROR}`);
  });
});

describe("Field's row layout", () => {
  function renderRow() {
    return render(
      <Field id={ID} label={LABEL} hintText={HINT} error={ERROR} layout="row">
        <input {...describeField(ID, { error: ERROR, hint: true })} />
        <button type="button">Go</button>
      </Field>,
    );
  }

  it("adds the row class to the field root", () => {
    const { container } = renderRow();
    const root = rootOf(container);

    expect(root).toHaveClass(styles.field, styles.row);
    expect(root).not.toHaveClass(styles.checkbox);
  });

  it("keeps stack's order: the label, the children in order, the hint, the error", () => {
    const { container } = renderRow();

    expect(order(rootOf(container))).toEqual([
      "label",
      "control",
      "action",
      "hint",
      "error",
    ]);
  });

  it("keeps the control's name and description", () => {
    renderRow();
    const box = screen.getByRole("textbox", { name: LABEL });

    expect(box).toHaveAccessibleDescription(`${HINT} ${ERROR}`);
  });
});

describe("FormField.module.css: the checkbox layout", () => {
  const CHECKBOX = /^\.checkbox$/;

  it("defines .checkbox and .row on disk", () => {
    const defined = rules().flatMap(selectors);
    expect(defined).toContain(".checkbox");
    expect(defined).toContain(".row");
  });

  it("is a wrapping, centred row at least the target size high", () => {
    expect(valueFor(CHECKBOX, "flex-direction")).toBe("row");
    expect(valueFor(CHECKBOX, "flex-wrap")).toBe("wrap");
    expect(valueFor(CHECKBOX, "align-items")).toBe("center");
    expect(valueFor(CHECKBOX, "min-height")).toBe("var(--target-min)");
  });

  it("sizes the box 1.25rem square, flex: none, margin 0", () => {
    const BOX = /^\.checkbox\s*>\s*input(\[type=["']?checkbox["']?\])?$/;

    expect(rulesMatching(BOX), "a rule for the box").not.toEqual([]);
    expect(valueFor(BOX, "width")).toBe("1.25rem");
    expect(valueFor(BOX, "height")).toBe("1.25rem");
    expect(valueFor(BOX, "flex")).toBe("none");
    expect(valueFor(BOX, "margin")).toBe("0");
  });

  it("stretches the label across the rest of the line (flex: 1)", () => {
    expect(valueFor(/^\.checkbox\s+(>\s*)?(\.label|label)$/, "flex")).toBe("1");
  });

  it("gives the hint and the error a line each (flex-basis: 100%)", () => {
    expect(valueFor(/^\.checkbox\s+(>\s*)?\.hint$/, "flex-basis")).toBe("100%");
    expect(valueFor(/^\.checkbox\s+(>\s*)?\.error$/, "flex-basis")).toBe(
      "100%",
    );
  });

  it("sets cursor: pointer only through selectors containing :enabled, and sets it", () => {
    const pointers = rules()
      .filter((block) => declared(block, "cursor") === "pointer")
      .flatMap(selectors);

    expect(
      pointers.length,
      "the enabled box keeps its pointer",
    ).toBeGreaterThan(0);
    for (const selector of pointers) {
      expect(selector).toMatch(/:enabled/);
    }
  });
});

describe("FormField.module.css: the row layout", () => {
  const ROW = /^\.row$/;

  it("is a grid: the control takes the room, the action keeps its width", () => {
    expect(valueFor(ROW, "display")).toBe("grid");
    expect(valueFor(ROW, "grid-template-columns")).toBe("minmax(0, 1fr) auto");
    expect(valueFor(ROW, "column-gap")).toMatch(/^var\(--space-\d+\)$/);
  });

  it.each(["label", "hint", "error"])(
    "spans the %s across the whole row",
    (part) => {
      const pattern = new RegExp(
        `^\\.row\\s+(>\\s*)?(\\.${part}${part === "label" ? "|label" : ""})$`,
      );
      expect(valueFor(pattern, "grid-column")).toBe("1 / -1");
    },
  );
});

describe("FormField.module.css as a whole", () => {
  it("uses only tokens, no px font sizes, and keeps a visible focus", () => {
    expect(moduleCssViolations(readSrcFile(FILE))).toEqual([]);
  });
});
