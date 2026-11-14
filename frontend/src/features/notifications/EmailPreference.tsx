import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { components } from "../../api/schema";
import { Field, describeField } from "../../components/FormField";
import { Card } from "../../components/ui/Card";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import styles from "./Notifications.module.css";
import {
  PREFERENCE_QUERY_KEY,
  fetchEmailPreference,
  setEmailPreference,
} from "./api";

/**
 * The email-notification preference.
 *
 * `email_notifications_enabled` is the only flag there is: in-app notifications
 * cannot be switched off by business rule ([[0x05-notifications]]), so there is
 * no second control here.
 *
 * **The server says whether email is available** (`email_available`,
 * [[0x05-notifications]]). When it is not, the box is disabled and captioned, and
 * still shows the stored position: that does not misstate what is stored, and the
 * choice is honoured if email returns. Nothing here decides availability, so
 * nothing needs finding and removing the day email is switched on.
 *
 * **Optimistic, through the mutation lifecycle**, the shape `FollowButton` uses:
 * `onMutate` cancels the in-flight read and snapshots the entry, `onError` puts
 * the snapshot back and raises an alert, `onSettled` invalidates the exact key —
 * the server owns this value, and a write that half-succeeded must not leave the
 * control claiming otherwise.
 *
 * A native checkbox rather than a `role="switch"` div: it is focusable, operable
 * with the space bar and readable by assistive technology without a line of code,
 * and every one of those is something a div has to re-implement and usually only
 * half does.
 *
 * **One card, whatever the state.** The loading and error lines render inside
 * the same one-row card the checkbox does (`layout.md` §3), so the strip does
 * not appear from nothing and push the list down once the read lands.
 */

type NotificationPreferenceOut =
  components["schemas"]["NotificationPreferenceOut"];

const EMAIL_FIELD_ID = "email-notifications";

const EMAIL_UNAVAILABLE =
  "Email notifications are not available right now. You will still see them here.";

/** The cache entry `onMutate` patched, kept so `onError` can put it back. */
interface PreferenceSnapshot {
  previous: NotificationPreferenceOut | undefined;
}

export function EmailPreference() {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const preference = useQuery({
    queryKey: PREFERENCE_QUERY_KEY,
    queryFn: fetchEmailPreference,
  });

  const update = useMutation<
    NotificationPreferenceOut,
    Error,
    boolean,
    PreferenceSnapshot
  >({
    mutationFn: setEmailPreference,

    onMutate: async (next: boolean): Promise<PreferenceSnapshot> => {
      // A read that lands after the patch would overwrite it with the answer it
      // was already carrying, from before the user touched the control.
      await queryClient.cancelQueries({
        queryKey: PREFERENCE_QUERY_KEY,
        exact: true,
      });

      const previous =
        queryClient.getQueryData<NotificationPreferenceOut>(
          PREFERENCE_QUERY_KEY,
        );
      // Spread: this write is about the stored flag, and must not lose
      // `email_available`, or the control reads as unavailable while it is in flight.
      if (previous !== undefined) {
        queryClient.setQueryData<NotificationPreferenceOut>(
          PREFERENCE_QUERY_KEY,
          { ...previous, email_notifications_enabled: next },
        );
      }

      return { previous };
    },

    onError: (_error, _next, snapshot) => {
      if (snapshot?.previous !== undefined) {
        queryClient.setQueryData(PREFERENCE_QUERY_KEY, snapshot.previous);
      }
      // The reason is never the failure's own text: it may carry a URL or a
      // status the user cannot act on, and this is the one thing they can.
      setFailure("We could not save that preference. Please try again.");
    },

    onSettled: () => {
      // Exact, the way `features/profile` does it: `["notifications"]` would be a
      // prefix match and would drag the list into a write about one checkbox.
      void queryClient.invalidateQueries({
        queryKey: PREFERENCE_QUERY_KEY,
        exact: true,
      });
    },
  });

  if (preference.isPending) {
    return (
      <Card className={styles.preference}>
        <StatusLine>Loading your email preference…</StatusLine>
      </Card>
    );
  }
  if (preference.isError || preference.data === undefined) {
    return (
      <Card className={styles.preference}>
        <InlineAlert>
          We could not load your email preference. Please try again.
        </InlineAlert>
      </Card>
    );
  }

  const available = preference.data.email_available;

  return (
    <Card className={styles.preference}>
      <Field
        id={EMAIL_FIELD_ID}
        label="Email me about new notifications"
        {...(available ? {} : { hintText: EMAIL_UNAVAILABLE })}
      >
        <input
          {...describeField(EMAIL_FIELD_ID, { hint: !available })}
          type="checkbox"
          checked={preference.data.email_notifications_enabled}
          disabled={!available}
          onChange={(event) => {
            setFailure(null);
            update.mutate(event.target.checked);
          }}
        />
      </Field>
      {/*
        An alert rather than the field's own message: this is a failure about the
        request, not about anything the user typed — the split `FormField`
        documents.
      */}
      {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}
    </Card>
  );
}
