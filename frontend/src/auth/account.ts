import {
  hashKey,
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { flushSync } from "react-dom";

import { apiClient } from "../api/client";
import type { components } from "../api/schema";
import { useAuth } from "./AuthContext";
import { ACCOUNT_DEACTIVATED, PROFILE_QUERY_KEY, useProfile } from "./profile";

type MeOut = components["schemas"]["MeOut"];

/**
 * The account state, decided once for the whole app (`FRONTEND-012`).
 *
 * | session        | `GET /users/me`           | `status`        |
 * |----------------|---------------------------|-----------------|
 * | not restored   | —                         | `"loading"`     |
 * | none           | never asked               | `"anonymous"`   |
 * | restored       | in flight                 | `"loading"`     |
 * | restored       | 200 `MeOut`               | `"active"`, with `profile` |
 * | restored       | 403 `account_deactivated` | `"deactivated"` |
 * | restored       | 404                       | `"no-profile"`  |
 * | restored       | any other failure         | `"unavailable"` |
 *
 * The last two are the guards' business (profile creation, and "we could not
 * check"); everyone else needs only the first five. Read from `useAuth()` and
 * the one profile query, so it costs no request of its own. The post card's
 * controls, the stats pages' "Post about this" links, the shell's banner and
 * the guards all read this hook: a component comparing the profile query's
 * answer itself would be a second place deciding it.
 *
 * **A deactivated account browses as a guest** (the human, 2026-10-22): gated
 * on writes, not locked out. Only a *known* deactivated account is: a session
 * whose profile is still loading, or failed to load, keeps the member's
 * controls, because the server is the one that refuses a write.
 */
export type AccountState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "active"; profile: MeOut }
  | { status: "deactivated" }
  | { status: "no-profile" }
  | { status: "unavailable" };

export type AccountStatus = AccountState["status"];

export function useAccount(): AccountState {
  const { status } = useAuth();
  const profile = useProfile(status === "authenticated");

  if (status === "loading") return { status: "loading" };
  if (status === "anonymous") return { status: "anonymous" };
  if (profile.isPending) return { status: "loading" };
  if (profile.isError) return { status: "unavailable" };
  if (profile.data === null) return { status: "no-profile" };
  if (profile.data === ACCOUNT_DEACTIVATED) return { status: "deactivated" };
  return { status: "active", profile: profile.data };
}

/**
 * Whether this account may be offered something only a signed-in member can
 * use (FRONTEND-017's "Post about this"): any settled session that is not
 * deactivated. A session with no profile yet is offered it, as before: the
 * route it leads to sends them to profile creation.
 */
export function offersMemberLinks(account: AccountState): boolean {
  return (
    account.status !== "loading" &&
    account.status !== "anonymous" &&
    account.status !== "deactivated"
  );
}

const PROFILE_HASH = hashKey(PROFILE_QUERY_KEY);

/** `DELETE /users/me` → 204: deactivates the caller's own account (`USERS-003`). */
export async function deactivateAccount(): Promise<void> {
  const { response } = await apiClient.DELETE("/users/me");
  if (!response.ok) {
    throw new Error(`DELETE /users/me answered ${response.status}`);
  }
}

/** `POST /users/me/recover` → 200 `MeOut`: lifts the deactivation (`USERS-003`). */
export async function recoverAccount(): Promise<void> {
  const { response } = await apiClient.POST("/users/me/recover");
  if (!response.ok) {
    throw new Error(`POST /users/me/recover answered ${response.status}`);
  }
}

/**
 * Deactivate, then make the app forget the member it was showing.
 *
 * Everything cached was read as an active member (the feed's liked and
 * reposted flags, the follow set, notifications), so all of it is reset —
 * except the profile entry, which is read again instead: its answer, now the
 * deactivated one, is what moves the whole app to the deactivated state. The
 * session is not touched: deactivating is not signing out, and Cognito is
 * where the owner signs in to recover ([[0x01-users]]).
 */
export function useDeactivateAccount(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deactivateAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROFILE_QUERY_KEY,
        exact: true,
      });
      await queryClient.resetQueries({
        predicate: (query) => query.queryHash !== PROFILE_HASH,
      });
    },
  });
}

/**
 * Recover, then read everything again: every cached answer was the
 * deactivated account's guest view, and the profile among them is what puts
 * the member's controls back.
 */
export function useRecoverAccount(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recoverAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });
}

/**
 * Sign out, and leave nothing of that account for the next person on this tab.
 * No feed key carries a viewer, so the cache holds the member's ranking and
 * pressed Likes, and their notifications, under keys a guest reads too.
 *
 * The profile answer is removed rather than read again: with no session there
 * is nothing to ask. Everything else is reset, not removed, because a mounted
 * page would otherwise go on showing its old result: reset drops the data and
 * reads again what is on screen, and the token provider reads the session per
 * request, so that read goes out as a guest.
 *
 * **`flushSync`, so the reset sees a signed-out app.** The app has to have
 * rendered the sign-out first: a guarded page has been swapped for its redirect
 * and a signed-in-only query is disabled by then, so neither is read again as a
 * guest, which would only be answered with a 401.
 */
export function useSignOut(): () => void {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  return () => {
    flushSync(signOut);
    queryClient.removeQueries({ queryKey: PROFILE_QUERY_KEY, exact: true });
    void queryClient.resetQueries();
  };
}
