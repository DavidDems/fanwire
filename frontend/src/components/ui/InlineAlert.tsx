import type { ReactNode } from "react";

import { CircleAlertIcon } from "./icons";
import styles from "./message.module.css";

export interface InlineAlertProps {
  children: ReactNode;
  /**
   * For a field whose error *is* this alert: the control's `aria-describedby`
   * names the alert itself, so the message is both its description and an
   * announcement. Only an `id`, not every `<p>` attribute: the role, classes and
   * icon are what make it this component, and a caller must not override them.
   */
  id?: string;
}

/** A request failure, beside the control it is about: `<p role="alert">`. */
export function InlineAlert({ children, id }: InlineAlertProps) {
  return (
    <p id={id} role="alert" className={`${styles.message} ${styles.danger}`}>
      <CircleAlertIcon className={styles.icon} />
      <span>{children}</span>
    </p>
  );
}
