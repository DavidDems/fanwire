import type { InputHTMLAttributes } from "react";

import { Field, describeField } from "../FormField";
import { SearchIcon } from "./icons";
import styles from "./SearchInput.module.css";

export interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type" | "className"
> {
  /** The input's id, which the label and the error message are wired to. */
  id: string;
  /** The visible label above the field, and the box's accessible name. */
  label: string;
  /** The message about this field, or `undefined` when it is fine. */
  error?: string;
}

/**
 * A search field with a leading search icon (`UI-010`,
 * `wiki/CodeContext/FrontendUI/components.md` §5): FormField's `<Field>` for the
 * label above and the error below, and inside it a wrapper holding the icon and
 * an `<input type="search">`. The icon is aria-hidden, so the label alone names
 * the box. Every other input prop passes through, so the caller owns `value`,
 * `onChange`, `name` and the rest.
 */
export function SearchInput({ id, label, error, ...rest }: SearchInputProps) {
  return (
    <Field id={id} label={label} error={error}>
      <div className={styles.wrapper}>
        <SearchIcon className={styles.icon} />
        <input
          {...rest}
          {...describeField(id, { error })}
          type="search"
          className={styles.input}
        />
      </div>
    </Field>
  );
}
