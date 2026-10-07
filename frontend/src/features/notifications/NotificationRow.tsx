import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import type { components } from "../../api/schema";
import { Button } from "../../components/ui/Button";
import { XIcon } from "../../components/ui/icons";
import styles from "./Notifications.module.css";
import { ACTOR_STALE_TIME_MS, actorKey, fetchActor } from "./api";

/**
 * One entry in the list.
 *
 * **The actor is a query, not a prop.** Every row asks react-query for its own
 * actor under `actorKey(actor_user_id)`, and ten rows from one actor therefore
 * produce one `GET /users/{user_id}` — the library deduplicates by key while the
 * requests are in flight and serves the rest from the entry afterwards. A
 * `useEffect` fetch per row renders exactly the same thing and issues ten.
 *
 * **Where an entry points is decided by its `type`, not by `reference_id`.** On a
 * `follow`, `reference_id` *is* the actor's own user id ([[0x05-notifications]]),
 * so a row that sent every `reference_id` to `/posts/` would produce a link to a
 * post whose id is really a user's, and look entirely plausible doing it.
 *
 * **An unrecognised `type` renders a generic entry.** `NotificationType` is the
 * closed set `follow | reply | repost` in the generated schema, so this switch
 * could be written exhaustively and the compiler would agree — but the bundle
 * outlives the contract it was built against, and a list that throws on one row
 * takes down the rows it *does* understand, while one that renders nothing is
 * indistinguishable from a broken fetch.
 *
 * **Styled as one divided row of the page's list card** (`components.md` §5):
 * the actor link is the strongest thing in it, the time is muted and tabular,
 * and Clear is a ghost button that never wraps away from the text it clears.
 * The row is never a `Card` of its own — the dividers between rows are the
 * page module's `.row + .row` rule.
 */

type NotificationOut = components["schemas"]["NotificationOut"];

/** Shown until `GET /users/{user_id}` answers — a row is never blank while it waits. */
const UNRESOLVED_ACTOR = "Someone";

export interface NotificationRowProps {
  notification: NotificationOut;
  /** Asks the page to clear this entry; the mutation and its snapshot live there. */
  onClear: (notificationId: number) => void;
}

export function NotificationRow({
  notification,
  onClear,
}: NotificationRowProps) {
  const {
    actor_user_id: actorId,
    reference_id: referenceId,
    type,
  } = notification;

  const actor = useQuery({
    queryKey: actorKey(actorId),
    queryFn: () => fetchActor(actorId),
    staleTime: ACTOR_STALE_TIME_MS,
  });

  const name = actor.data?.username ?? UNRESOLVED_ACTOR;
  // "Someone" is linked and weighted like a resolved name: it is a placeholder
  // for the same thing, not a different kind of text.
  const actorLink = (
    <Link to={`/profile/${actorId}`} className={styles.actor}>
      {name}
    </Link>
  );

  return (
    <li className={styles.row}>
      <div className={styles.body}>
        <p>{describe(type, actorLink, referenceId)}</p>
        <time dateTime={notification.created_at} className={styles.when}>
          {formatWhen(notification.created_at)}
        </time>
      </div>
      {/*
        The visible label is one word so a list of them stays readable, and the
        accessible name says which entry it belongs to — "Clear" repeated down a
        page tells a screen-reader user nothing about what they are about to act
        on. The icon is aria-hidden, so it adds nothing to either.
      */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={styles.clear}
        aria-label={`Clear this notification from ${name}`}
        onClick={() => {
          onClear(notification.id);
        }}
      >
        <XIcon />
        Clear
      </Button>
    </li>
  );
}

/**
 * What the entry says, with the actor already linked.
 *
 * `reference_id` is nullable in the schema, so a reply or repost that arrives
 * without one still reads correctly — it just has nothing to link to.
 */
function describe(
  type: NotificationOut["type"],
  actorLink: ReactNode,
  referenceId: number | null,
): ReactNode {
  const post =
    referenceId === null ? (
      "your post"
    ) : (
      <Link to={`/posts/${referenceId}`}>your post</Link>
    );

  switch (type) {
    case "follow":
      return <>{actorLink} started following you.</>;
    case "reply":
      return (
        <>
          {actorLink} replied to {post}.
        </>
      );
    case "repost":
      return (
        <>
          {actorLink} reposted {post}.
        </>
      );
    default:
      // Deliberately reachable: see the file header.
      return <>{actorLink} sent you a notification.</>;
  }
}

/** The entry's time, in the reader's own locale. The machine-readable value is on `dateTime`. */
function formatWhen(createdAt: string): string {
  return new Date(createdAt).toLocaleString();
}
