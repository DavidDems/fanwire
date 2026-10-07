import { useSyncExternalStore } from "react";

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
}

const TEXT_BOX_ID = "compose-text";

export function ComposeTextBox({ mediator }: ComposeTextBoxProps) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);

  return (
    <Field
      id={TEXT_BOX_ID}
      label="Post"
      hintText="Type # to mention a game, or $ to mention a team."
    >
      <textarea
        {...describeField(TEXT_BOX_ID, { hint: true })}
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
