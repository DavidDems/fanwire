import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { components } from "../../api/schema";
import { EmailPreference } from "./EmailPreference";
import { NotificationRow } from "./NotificationRow";
import { NOTIFICATIONS_QUERY_KEY, clearNotification, fetchNotifications } from "./api";

/**
 * `/notifications` — the list, the clear, and the email preference.
 *
 * **The clear is optimistic, and the rollback is a snapshot.** `onMutate` cancels
 * the in-flight read, keeps the array as it was and writes back the one without
 * the cleared entry; `onError` puts the *snapshot* back. That is the whole reason
 * it is a snapshot rather than a re-insert: restoring an entry as
 * `[...remaining, cleared]` puts it at the end, which is also what a naive
 * refetch-on-error produces, and a notification that reappears somewhere else
 * reads as a second bug rather than as a failure that was undone.
 *
 * **One mutation for the whole list, not one per row.** The row it clears is
 * unmounted the moment the patch lands, so a mutation owned by the row would take
 * its own `onError` and its own failure message down with it, and the user would
 * watch the entry come back with nothing saying why.
 *
 * **No session check here.** `/notifications` is behind `RequireAuth` in
 * `routes/routes.tsx` ([[0x08-frontend]]), which is the one place that decides who
 * may see this page; re-deciding it here would be a second answer to the same
 * question, free to disagree with the first.
 */

type NotificationOut = components["schemas"]["NotificationOut"];

/** The list as it was before the optimistic removal — restored verbatim on failure. */
interface ClearSnapshot {
  entries: NotificationOut[] | undefined;
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const notifications = useQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: fetchNotifications,
  });

  const clear = useMutation<void, Error, number, ClearSnapshot>({
    mutationFn: clearNotification,

    onMutate: async (notificationId: number): Promise<ClearSnapshot> => {
      // An in-flight read landing after the patch would put the cleared entry
      // straight back, with the answer it was already carrying.
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_QUERY_KEY, exact: true });

      const entries = queryClient.getQueryData<NotificationOut[]>(NOTIFICATIONS_QUERY_KEY);
      queryClient.setQueryData<NotificationOut[]>(NOTIFICATIONS_QUERY_KEY, (current) =>
        current?.filter((entry) => entry.id !== notificationId),
      );

      return { entries };
    },

    onError: (_error, _notificationId, snapshot) => {
      if (snapshot?.entries !== undefined) {
        queryClient.setQueryData(NOTIFICATIONS_QUERY_KEY, snapshot.entries);
      }
      setFailure("We could not clear that notification. Please try again.");
    },

    onSettled: () => {
      // The server owns the list: something may have arrived while the clear was
      // in flight. Exact, so this cannot reach the preference entry beside it.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY, exact: true });
    },
  });

  function renderList() {
    if (notifications.isPending) {
      return <p role="status">Loading your notifications…</p>;
    }
    if (notifications.isError || notifications.data === undefined) {
      return <p role="alert">We could not load your notifications. Please try again.</p>;
    }
    // Said out loud rather than left as an empty list: a page that renders
    // nothing at all for an empty response is indistinguishable from one that is
    // still loading, and the user never learns there is nothing to read.
    if (notifications.data.length === 0) {
      return <p>You have no notifications.</p>;
    }

    return (
      <ul>
        {notifications.data.map((notification) => (
          <NotificationRow
            // Keyed by the entry's own id, so a row keeps its resolved actor when
            // the list around it changes rather than remounting and re-asking.
            key={notification.id}
            notification={notification}
            onClear={(notificationId) => {
              setFailure(null);
              clear.mutate(notificationId);
            }}
          />
        ))}
      </ul>
    );
  }

  return (
    <section>
      <h1>Notifications</h1>

      <EmailPreference />

      {failure === null ? null : <p role="alert">{failure}</p>}

      {renderList()}
    </section>
  );
}
