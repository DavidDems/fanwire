import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { components } from "../../api/schema";
import { Field, describeField } from "../../components/FormField";
import { PREFERENCE_QUERY_KEY, fetchEmailPreference, setEmailPreference } from "./api";

/**
 * The email-notification preference.
 *
 * `email_notifications_enabled` is the only flag there is: in-app notifications
 * cannot be switched off by business rule ([[0x05-notifications]]), so there is
 * no second control here.
 *
 * **The control is enabled and explains nothing about SES.** Email delivery is a
 * deliberate no-op in every environment today — `SesEmailSender` skips sending
 * while `NOTIFICATION_FROM_ADDRESS` is unset and no identity is verified yet — but
 * that is a deployment state, not a feature flag. The toggle stores a real
 * preference, and a control that apologised for the environment it happens to be
 * running in would have to be found and removed the day SES is verified.
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
 */

type NotificationPreferenceOut = components["schemas"]["NotificationPreferenceOut"];

const EMAIL_FIELD_ID = "email-notifications";

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

  const update = useMutation<NotificationPreferenceOut, Error, boolean, PreferenceSnapshot>({
    mutationFn: setEmailPreference,

    onMutate: async (next: boolean): Promise<PreferenceSnapshot> => {
      // A read that lands after the patch would overwrite it with the answer it
      // was already carrying, from before the user touched the control.
      await queryClient.cancelQueries({ queryKey: PREFERENCE_QUERY_KEY, exact: true });

      const previous = queryClient.getQueryData<NotificationPreferenceOut>(PREFERENCE_QUERY_KEY);
      queryClient.setQueryData<NotificationPreferenceOut>(PREFERENCE_QUERY_KEY, {
        email_notifications_enabled: next,
      });

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
      void queryClient.invalidateQueries({ queryKey: PREFERENCE_QUERY_KEY, exact: true });
    },
  });

  if (preference.isPending) {
    return <p role="status">Loading your email preference…</p>;
  }
  if (preference.isError || preference.data === undefined) {
    return <p role="alert">We could not load your email preference. Please try again.</p>;
  }

  return (
    <div>
      <Field id={EMAIL_FIELD_ID} label="Email me about new notifications">
        <input
          {...describeField(EMAIL_FIELD_ID)}
          type="checkbox"
          checked={preference.data.email_notifications_enabled}
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
      {failure === null ? null : <p role="alert">{failure}</p>}
    </div>
  );
}
