import { screen, within } from "@testing-library/react";
import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";
import { ACCOUNT_DEACTIVATED_BODY, testProfile } from "./auth";

/**
 * The account-lifecycle kit (`FRONTEND-012`, on `USERS-003`): a small mutable
 * server for the three requests that move an account between active and
 * deactivated, and the readers for the banner a deactivated account sees.
 *
 * | request                    | active                | deactivated            |
 * |----------------------------|-----------------------|------------------------|
 * | `GET /users/me`            | 200 `MeOut`           | 403 `account_deactivated` |
 * | `DELETE /users/me`         | 204, now deactivated  | 204 (a no-op)          |
 * | `POST /users/me/recover`   | 200 `MeOut` (no-op)   | 200 `MeOut`, now active |
 *
 * The state moves only when the write lands, so the read after it is the
 * server's own answer, never one the test arranged in advance. `./auth`'s
 * `profileFound` / `profileDeactivated` are the fixed versions of the first
 * row; this one is for a test that crosses from one state to the other.
 */

type MeOut = components["schemas"]["MeOut"];

export type AccountStatus = "active" | "deactivated";

export interface AccountServer {
  /** `GET`/`DELETE /users/me` and `POST /users/me/recover` — install them together. */
  handlers: RequestHandler[];
  /** One entry per `GET /users/me`. */
  readonly meRequests: string[];
  /** One entry per `DELETE /users/me`. */
  readonly deactivations: string[];
  /** One entry per `POST /users/me/recover`. */
  readonly recoveries: string[];
  /** Where the account stands now. */
  status(): AccountStatus;
  /** Answer every `POST /users/me/recover` with a 500 from here on. */
  failRecover(): void;
  /** Hold every `POST /users/me/recover` open until the returned function is called. */
  holdRecover(): () => void;
}

export function accountServer(
  initial: AccountStatus = "active",
  profile: MeOut = testProfile(),
): AccountServer {
  const meRequests: string[] = [];
  const deactivations: string[] = [];
  const recoveries: string[] = [];
  let status = initial;
  let recoverFails = false;
  let gate: Promise<void> | null = null;

  return {
    handlers: [
      http.get("*/users/me", ({ request }) => {
        meRequests.push(request.url);
        if (status === "deactivated") {
          return HttpResponse.json(ACCOUNT_DEACTIVATED_BODY, { status: 403 });
        }
        return HttpResponse.json<MeOut>(profile);
      }),
      http.delete("*/users/me", ({ request }) => {
        deactivations.push(request.url);
        status = "deactivated";
        return new HttpResponse(null, { status: 204 });
      }),
      http.post("*/users/me/recover", async ({ request }) => {
        // Recorded before the gate, so a held call is still observable as "sent".
        recoveries.push(request.url);
        if (gate !== null) await gate;
        if (recoverFails) {
          return HttpResponse.json(
            { detail: "Internal Server Error" },
            { status: 500 },
          );
        }
        status = "active";
        return HttpResponse.json<MeOut>(profile);
      }),
    ],
    meRequests,
    deactivations,
    recoveries,
    status: () => status,
    failRecover(): void {
      recoverFails = true;
    },
    holdRecover(): () => void {
      let open = (): void => {};
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        open();
        gate = null;
      };
    },
  };
}

/** What the deactivated banner's accessible name (and its text) says. */
export const DEACTIVATED_TEXT = /your account is deactivated/i;

/**
 * The banner every page shows a deactivated account: a named `region`, never a
 * second `<header>` (`accessibility.md` A12: one banner landmark per page).
 */
export async function deactivatedBanner(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: DEACTIVATED_TEXT });
}

/** The banner, or `null` when the account is not (or no longer) deactivated. */
export function queryDeactivatedBanner(): HTMLElement | null {
  return screen.queryByRole("region", { name: DEACTIVATED_TEXT });
}

/**
 * Resolve once the shell shows the deactivated state: by then the one account
 * hook says `deactivated`, so an absent control is absent because of the
 * rule, not because the profile had not been read yet. The deactivated twin
 * of `./post-about`'s `signedInShown`.
 */
export async function deactivatedShown(): Promise<HTMLElement> {
  const banner = await deactivatedBanner();
  within(banner).getByRole("button", { name: "Recover account" });
  return banner;
}
