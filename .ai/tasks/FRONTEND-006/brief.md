# FRONTEND-006 — notifications

Depends on `FRONTEND-002` being on `main`. The links it renders are more useful
once `FRONTEND-003` and `FRONTEND-005` have landed, but nothing here blocks on
them — a link to a route that renders a placeholder is fine.

## Clearing is a soft delete

`POST /notifications/{id}/clear` is a soft delete on the backend. From the UI's
point of view it removes the entry; from the backend's it sets a flag. Nothing
in this unit should expose the distinction.

Optimistic removal means the row disappears immediately and is **restored to its
original position** on failure — not appended to the end of the list, which is
what a naive refetch-on-error produces and what makes the failure look like a
second bug.

## One request per actor, not per notification

Ten notifications from the same actor must produce one `GET /users/{id}`. This
is react-query doing its job with a stable query key, and it is the reason that
library is in the dependency list at all. A `useEffect` fetch per row is the
implementation this criterion exists to reject.

## Unknown types

The backend's notification types are follow, reply and repost today. An
unrecognised type renders a generic entry. It does not throw, and it does not
render nothing — a notification list that silently drops rows it does not
understand is indistinguishable from a broken fetch.

## Email preference

`GET` and `PUT /notifications/preference`. Worth knowing, and worth a sentence
in the wiki entry: **email notification is a deliberate no-op in every
environment today.** `app.notifications.email.SesEmailSender` skips sending
whenever `NOTIFICATION_FROM_ADDRESS` is unset, and no SES identity exists yet
(`TODO/02-deployment-requirements.md` §2). The toggle stores a real preference;
nothing acts on it until SES is verified. Do not disable the control and do not
explain this to the user in the UI — it is a deployment state, not a feature
flag.
