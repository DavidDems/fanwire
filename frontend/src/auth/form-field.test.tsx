/**
 * UI-004 acceptance criterion 5: `FormField`'s `Field`, restyled, keeps its
 * markup — label, then the control, then the hint, then the error, in DOM
 * order, with the ids `<id>-hint` and `<id>-error` that `describeField` points
 * the control's `aria-describedby` at. The error gains a leading icon
 * (`components.md` §5), which is `aria-hidden` so the message's text and the
 * control's accessible description stay exactly the message.
 *
 * Rendered directly with a plain `<input>`, the way every page uses it. It
 * lives here rather than beside `FormField.tsx` because `FormField.test.tsx`
 * is not this unit's to write.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, describeField } from "../components/FormField";

const ID = "test-field";
const LABEL = "Date of birth";
const HINT = "Only you can see this. It is never shown on your profile.";
const ERROR = "Value error, must be at least 16 years old";

function renderField({ error, hint }: { error?: string; hint?: string }): void {
  render(
    <Field id={ID} label={LABEL} error={error} hintText={hint}>
      <input
        {...describeField(ID, { error, hint: hint !== undefined })}
        type="text"
        name="field"
      />
    </Field>,
  );
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`nothing has id="${id}"`);
  return element;
}

/** True when `a` comes before `b` in document order. */
function precedes(a: Node, b: Node): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("Field keeps its markup (criterion 5)", () => {
  it("renders label, control, hint, error in that order, with the same ids", () => {
    renderField({ error: ERROR, hint: HINT });

    const control = screen.getByLabelText(LABEL);
    const label = document.querySelector(`label[for="${ID}"]`);
    expect(label, "no <label> for the control").not.toBeNull();
    expect(control).toHaveAttribute("id", ID);

    const hint = byId(`${ID}-hint`);
    const error = byId(`${ID}-error`);

    expect(precedes(label as Element, control)).toBe(true);
    expect(precedes(control, hint)).toBe(true);
    expect(precedes(hint, error)).toBe(true);
  });

  it("keeps the hint's text and the control's description", () => {
    renderField({ hint: HINT });

    expect(byId(`${ID}-hint`)).toHaveTextContent(HINT);
    expect(byId(`${ID}-hint`).textContent?.trim()).toBe(HINT);
    expect(screen.getByLabelText(LABEL)).toHaveAccessibleDescription(HINT);
  });

  it("renders no error element while the field is fine", () => {
    renderField({});

    expect(document.getElementById(`${ID}-error`)).toBeNull();
    expect(screen.getByLabelText(LABEL)).not.toHaveAttribute("aria-invalid");
  });
});

describe("Field's error message (criterion 5)", () => {
  it("has a leading icon that is aria-hidden", () => {
    renderField({ error: ERROR });

    const icons = byId(`${ID}-error`).querySelectorAll("svg");
    expect(icons.length, "the error message has no icon").toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("keeps its text exactly the message", () => {
    renderField({ error: ERROR });

    const error = byId(`${ID}-error`);
    expect(error).toHaveTextContent(ERROR);
    expect(error.textContent?.trim()).toBe(ERROR);
  });

  it("is still the control's accessible description, word for word", () => {
    renderField({ error: ERROR });

    const control = screen.getByLabelText(LABEL);
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute("aria-describedby", `${ID}-error`);
    expect(control).toHaveAccessibleDescription(ERROR);
  });

  it("is described after the hint when both are shown", () => {
    renderField({ error: ERROR, hint: HINT });

    expect(screen.getByLabelText(LABEL)).toHaveAccessibleDescription(
      `${HINT} ${ERROR}`,
    );
  });

  it("is not an alert: the field message is announced through the control", () => {
    renderField({ error: ERROR });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
