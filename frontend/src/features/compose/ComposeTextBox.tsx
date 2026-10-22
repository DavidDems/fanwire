import { useEffect, useRef, useSyncExternalStore } from "react";

import { Field, describeField } from "../../components/FormField";
import type { ComposeMediator } from "./ComposeMediator";
import styles from "./ComposeTextBox.module.css";

/**
 * The text box.
 *
 * It reports what was typed to the mediator and renders what the mediator
 * publishes — including text it did not produce, such as a template's opening
 * or the text an Undo restored. It imports neither of the other two compose
 * controls, and `component-isolation.test.ts` reads this file from disk to keep
 * it that way.
 *
 * It has no standing hint since `FRONTEND-013`: the "Type # to mention a game,
 * or $ to mention a team" line went with the dropdown it described. A typed
 * `#GameId123` is plain text now; stats are attached with Attach stats.
 */

export interface ComposeTextBoxProps {
  mediator: ComposeMediator;
  /** The visible label; "Post" on `/compose`. */
  label?: string;
  /**
   * The id of an element elsewhere that describes the box too — the inline
   * composer's "Replying to @username".
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
  const field = describeField(TEXT_BOX_ID);

  // A passive effect rather than the `autoFocus` attribute: it runs after the
  // dialog the box may sit in has opened, so the browser's own dialog
  // focusing cannot take the focus back from it.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  return (
    <Field id={TEXT_BOX_ID} label={label}>
      <textarea
        {...field}
        aria-describedby={describedBy}
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
