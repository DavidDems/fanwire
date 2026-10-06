import styles from "./Avatar.module.css";

export interface AvatarProps {
  username: string;
  size: "sm" | "lg";
}

/**
 * The username's first character as typed — never uppercased. `aria-hidden`:
 * the username is always beside it. One fill for everyone; no per-user colours.
 */
export function Avatar({ username, size }: AvatarProps) {
  // Array.from splits by code point, so an astral first character stays whole.
  const initial = Array.from(username)[0] ?? "";
  return (
    <span aria-hidden="true" className={`${styles.avatar} ${styles[size]}`}>
      {initial}
    </span>
  );
}
