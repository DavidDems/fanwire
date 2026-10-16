import { useEffect, useRef, useSyncExternalStore } from "react";

import { Field, describeField } from "../../components/FormField";
import type { ComposeMediator } from "./ComposeMediator";
import styles from "./ComposeTextBox.module.css";

/**
 * The text box.
 *
 * It reports what was typed to the mediator and renders what the mediator
 * publishes — including text it did not produce, such as the token a chosen
 * suggestion inserted. It imports neither of the other two compose controls, and
 * `component-isolation.test.ts` reads this file from disk to keep it that way.
 */

export interface ComposeTextBoxProps {
  mediator: ComposeMediator;
  /** The visible label; "Post" on `/compose`. */
  label?: string;
  /**
   * The id of an element elsewhere that describes the box too — the inline
   * composer's "Replying to @username" — announced before the standing hint.
   */
  describedBy?: string;
  /** Focus the box once it is on screen (a thread opened to reply). */
  autoFocus?: boolean;
}

const TEXT_BOX_ID = "compose-text";

export function ComposeTextBox({
  mediator,
  label = "Post",
  describedBy,
  autoFocus = false,
}: ComposeTextBoxProps) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const field = describeField(TEXT_BOX_ID, { hint: true });
  const description = [describedBy, field["aria-describedby"]]
    .filter((token) => token !== undefined)
    .join(" ");

  // A passive effect rather than the `autoFocus` attribute: it runs after the
  // dialog the box may sit in has opened, so the browser's own dialog
  // focusing cannot take the focus back from it.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <Field
      id={TEXT_BOX_ID}
      label={label}
      hintText="Type # to mention a game, or $ to mention a team."
    >
      <textarea
        {...field}
        aria-describedby={description}
        ref={ref}
        className={styles.text}
        name="post-text"
        rows={4}
        value={draft.text}
        onChange={(event) => {
          mediator.send("text", {
            kind: "text-changed",
            text: event.target.value,
          });
        }}
      />
    </Field>
  );
}
