import type { ReactNode } from "react";

/**
 * A labelled control and, when the last attempt failed, the message about *that
 * control* — shared by all five auth pages.
 *
 * The association is made with `aria-describedby`, not by putting a `<p>` next
 * to the input: the accessible description is what a screen reader announces
 * when focus reaches the field, and a single banner at the top of a form is the
 * failure this exists to prevent.
 *
 * `<Field>` renders the label, the message and the standing hint; `describeField`
 * returns the attributes the control itself needs. They are separate because the
 * control varies — `input`, `select` and `textarea` all appear below — and
 * cloning children to inject props hides that from whoever reads the page.
 */

export interface FieldDescription {
  id: string;
  "aria-invalid"?: "true";
  "aria-describedby"?: string;
}

export interface FieldState {
  /** The message about this control, or `undefined` when it is fine. */
  error?: string;
  /** Whether the matching `<Field>` renders a hint, which is described too. */
  hint?: boolean;
}

/** The attributes for the control inside a `<Field>` with the same `id` and state. */
export function describeField(id: string, { error, hint }: FieldState = {}): FieldDescription {
  const describedBy = [hint === true ? `${id}-hint` : null, error === undefined ? null : `${id}-error`]
    .filter((token): token is string => token !== null)
    .join(" ");

  return {
    id,
    ...(error === undefined ? {} : { "aria-invalid": "true" as const }),
    ...(describedBy === "" ? {} : { "aria-describedby": describedBy }),
  };
}

export interface FieldProps {
  id: string;
  label: string;
  error?: string;
  /**
   * Standing help — a privacy note, a format. A field that renders one also
   * passes `hint: true` to `describeField`, so it is announced with the field
   * rather than sitting there unreferenced.
   */
  hintText?: ReactNode;
  children: ReactNode;
}

export function Field({ id, label, error, hintText, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {children}
      {hintText === undefined ? null : <p id={`${id}-hint`}>{hintText}</p>}
      {/*
        Not `role="alert"`: a field message is announced through the control's
        own description. The alert role is kept for failures that are about the
        request rather than about something the user typed.
      */}
      {error === undefined ? null : <p id={`${id}-error`}>{error}</p>}
    </div>
  );
}
