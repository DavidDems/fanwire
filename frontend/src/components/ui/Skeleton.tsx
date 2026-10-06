import styles from "./Skeleton.module.css";

/**
 * A static placeholder while something loads. `aria-hidden`: the `StatusLine`
 * beside it is what is announced. No shimmer (`components.md` §2).
 */
export function Skeleton({ variant }: { variant: "post" | "line" }) {
  if (variant === "line") {
    return <div aria-hidden="true" className={styles.bar} />;
  }
  return (
    <div aria-hidden="true" className={styles.post}>
      <div className={styles.avatar} />
      <div className={styles.lines}>
        <div className={styles.bar} />
        <div className={`${styles.bar} ${styles.short}`} />
      </div>
    </div>
  );
}
