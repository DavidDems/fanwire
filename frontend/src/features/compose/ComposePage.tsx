import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  AttachmentPicker,
  StatsToggle,
  type AddressLink,
} from "./AttachmentPicker";
import { ComposeMediator } from "./ComposeMediator";
import { ComposeTextBox } from "./ComposeTextBox";
import { MediaWidget } from "./MediaWidget";
import { PostBuilder } from "./PostBuilder";
import { QUICK_POST_TEMPLATES } from "./PostTemplate";
import { PostNotCreated, createPost } from "./createPost";
import { refusalMessage, type CareerScope } from "./dataLink";
import styles from "./ComposePage.module.css";

/**
 * The composer.
 *
 * It owns one `ComposeMediator` and hands it to all three controls — the text
 * box, the attachment picker and the media widget; that is the whole of the
 * wiring between them. It owns no draft state of its own — the mediator is the
 * store, and `PostBuilder` turns whatever the mediator currently holds into the
 * request.
 *
 * **Nothing is fetched when this page mounts.** The `events/` reads happen when
 * the Attach stats picker is used, templates are stored in the app, and the
 * media poll starts at the first upload. The one exception is an address that
 * carries a link (below), whose summary needs one read. The `#`/`$` mention
 * dropdown is gone (`FRONTEND-013`, the human 2026-10-22): typing fetches
 * nothing, and a typed `#GameId123` is sent as the plain text it is.
 *
 * **A failed `POST /posts` keeps the draft.** Losing a user's typed text on a 500
 * is the worst thing this page can do and the failure most likely to survive
 * review, because the happy path is what gets clicked. The composer is cleared in
 * exactly one place: `onSuccess`.
 *
 * **A refused link keeps the draft and says why.** `POST /posts` answers a
 * `data_link` it will not accept with a 422 whose detail is a machine code
 * (`POSTS-005`); each of the six gets its own message (`refusalMessage`), and
 * anything else — an unknown code, Pydantic's own list-shaped 422, a 500 —
 * keeps the generic one.
 *
 * **The address is how another feature opens this page in a context.**
 * `?reply_to=` and `?repost_of=` carry a post id into the mediator the composer
 * is built around. A route is the one seam a feature folder can hand another
 * without importing it, which is what the connection rule asks for. Since
 * `FRONTEND-010` the feed's reply control opens the thread modal instead, whose
 * reply box is `InlineComposer`, built from these same parts; the two
 * parameters keep working for anyone who opens them.
 * `src/features/compose/ComposeRoute.test.tsx` pins it.
 *
 * **The address can also carry one data link** (`FRONTEND-013`), the contract
 * `FRONTEND-017`'s stats-page entry points open the composer with:
 *
 * - `?link=game_final&ref=<game id>`
 * - `?link=player_game&ref=<line_id>&game=<game id>` — the game is only for
 *   finding the line to summarise, since there is no read of a line by id
 * - `?link=player_career&ref=<player id>&scope=regular|playoffs`
 *
 * `dataLinkIn` parses it; the picker checks what it names and attaches it with
 * its summary. An address that is wrong in any way — malformed here, or
 * refused by what the read returns — opens a plain composer with a note,
 * never a half-attached link. A reply cannot carry a link, so a reply address
 * offers no Attach stats, and says so if it was given a link anyway.
 *
 * **Shown in the compose dialog** (`FRONTEND-020`, `routes/ComposeModal.tsx`),
 * whose title is its heading, so it renders none of its own. Under the text
 * box is the attach row: the media widget's paperclip, and beside it Attach
 * stats (`StatsToggle`), which shows and hides the picker's panel; this page
 * holds whether it is open. Post waits while an image is being checked. A
 * published post invalidates every feed query (the `["feed"]` prefix, spelled
 * here because compose imports no other feature) and calls `onPosted`, which
 * the dialog answers by closing.
 *
 * **Laid out as one form card** (`wiki/CodeContext/FrontendUI/layout.md` §3):
 * the three controls stacked inside a `Card`, then a footer row with Undo on
 * the left and Post on the right. Undo walks back the last attach or replace
 * of stats (the mediator's `DraftSnapshot` history), so it sits here beside
 * Post, where Undo mention was, rather than inside the picker's summary. The
 * failure sits in that footer, just above Post, so the message is beside the
 * button that produced it.
 */

const GENERIC_FAILURE =
  "We could not post that. Your draft is still here — please try again.";

/** The address parameters that only mean something as part of a link. */
const LINK_PARAMS = ["link", "ref", "game", "scope"] as const;

const SCOPES: readonly CareerScope[] = ["regular", "playoffs"];

/**
 * A post id from the query string, or `null` for anything that is not one.
 *
 * The address bar is user input, so this validates at the boundary and does not
 * propagate a half-value inward: `Number("")` is `0` and `Number("x")` is `NaN`,
 * and a `NaN` reaches the API as `parent_post_id: null` on a post that still
 * claims `is_reply: true`. An unusable parameter is therefore no context at all
 * — the composer opens, and it opens as a plain one.
 */
function postIdIn(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null) return null;

  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The one value of a parameter: `null` when it is absent, `undefined` when it
 * is given more than once — which cannot name one link, so it is refused.
 */
function single(
  params: URLSearchParams,
  name: string,
): string | null | undefined {
  const values = params.getAll(name);
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : undefined;
}

/** A positive integer written in digits only, or `null`. */
function idFrom(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The data link a `/compose` address carries, or `null` for none.
 *
 * Validated at the boundary the way `postIdIn` is, and more strictly, because
 * a link names data the user did not pick by hand: anything that is not
 * *exactly* one of the three documented forms is `null`, never a half-value.
 * So an unknown or empty `link`; a missing, empty, zero, negative or
 * non-integer `ref`; a `player_game` without a usable `game`; a career whose
 * scope is not exactly `regular` or `playoffs`; and a parameter that does not
 * belong to the form (`scope` on a game, `game` on a career) are all refused.
 * Parameters that are not part of a link (`repost_of`) are not its business.
 *
 * `gameId` is the `game` parameter for a `player_game` and `null` otherwise:
 * it is how the line is found, not part of what the server receives.
 */
export function dataLinkIn(params: URLSearchParams): AddressLink | null {
  const type = single(params, "link");
  const ref = idFrom(single(params, "ref"));
  const game = single(params, "game");
  const scope = single(params, "scope");
  if (ref === null) return null;

  switch (type) {
    case "game_final":
      if (game !== null || scope !== null) return null;
      return { link: { type: "game_final", ref_id: ref }, gameId: null };

    case "player_game": {
      const gameId = idFrom(game);
      if (gameId === null || scope !== null) return null;
      return { link: { type: "player_game", ref_id: ref }, gameId };
    }

    case "player_career": {
      const known = SCOPES.find((candidate) => candidate === scope);
      if (known === undefined || game !== null) return null;
      return {
        link: { type: "player_career", ref_id: ref, scope: known },
        gameId: null,
      };
    }

    default:
      return null;
  }
}

/** Whether the address tried to carry a link at all, well formed or not. */
function asksForLink(params: URLSearchParams): boolean {
  return LINK_PARAMS.some((name) => params.has(name));
}

/** What the user is told when `POST /posts` did not create the post. */
function failureMessage(error: unknown): string {
  if (error instanceof PostNotCreated && error.status === 422) {
    return refusalMessage(error.detail) ?? GENERIC_FAILURE;
  }
  return GENERIC_FAILURE;
}

/** The feed's query-key prefix, as `features/feed` spells it. */
const FEED_KEY_ROOT = ["feed"] as const;

export interface ComposePageProps {
  /** Called once the post exists on the server: the dialog closes. */
  onPosted?: () => void;
}

export function ComposePage({ onPosted }: ComposePageProps = {}) {
  const [searchParams] = useSearchParams();
  const replyToPostId = postIdIn(searchParams, "reply_to");
  const repostOfPostId = postIdIn(searchParams, "repost_of");
  const addressLink = dataLinkIn(searchParams);
  const linkAsked = asksForLink(searchParams);
  // Stats are offered wherever the server would take them, which is anywhere
  // but a reply: a quote repost may carry them, with text of its own.
  const attachable = replyToPostId === null;

  let addressNote: string | null = null;
  if (linkAsked && !attachable) {
    addressNote =
      "Stats cannot be attached to a reply, so the link in this address is not attached.";
  } else if (linkAsked && addressLink === null) {
    addressNote =
      "The stats link in this address could not be read, so nothing is attached. You can still attach stats yourself.";
  }

  // Keyed on the ids rather than built once: the composer is a single mounted
  // page, so a second reply started from the feed while this one is open changes
  // only the address, and an empty dependency list would answer it with the
  // previous post's context. `reset()` returns to whichever one built it.
  const mediator = useMemo(
    () => new ComposeMediator({ replyToPostId, repostOfPostId }),
    [replyToPostId, repostOfPostId],
  );
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const checking = useSyncExternalStore(
    mediator.subscribe,
    mediator.isMediaChecking,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const statsPanelId = useId();
  const statsToggleId = useId();
  const queryClient = useQueryClient();

  // Rebuilt from the published draft on every render, so the submit control and
  // the request it sends can never disagree about what is in the composer.
  const builder = PostBuilder.from(draft);
  const canPost = builder.canBuild() && !checking;

  const submit = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      setFailure(null);
      mediator.reset();
      void queryClient.invalidateQueries({ queryKey: FEED_KEY_ROOT });
      onPosted?.();
    },
    onError: (error) => {
      setFailure(failureMessage(error));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canPost) return;
    setFailure(null);
    submit.mutate(builder.build());
  }

  // The picker is remounted for a new context or a new address link, so a
  // link checked for one composer is never attached to the next.
  const pickerKey = [
    repostOfPostId ?? "",
    ...LINK_PARAMS.map((name) => searchParams.getAll(name).join(",")),
  ].join("|");

  return (
    <section className={styles.page}>
      <Card>
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <ComposeTextBox mediator={mediator} />
          {addressNote === null ? null : <StatusLine>{addressNote}</StatusLine>}
          <MediaWidget
            mediator={mediator}
            tools={
              attachable ? (
                <StatsToggle
                  id={statsToggleId}
                  open={statsOpen}
                  panelId={statsPanelId}
                  onToggle={() => {
                    setStatsOpen((open) => !open);
                  }}
                />
              ) : null
            }
          />
          {attachable ? (
            <AttachmentPicker
              key={pickerKey}
              mediator={mediator}
              prefill={addressLink}
              open={statsOpen}
              onClose={() => {
                setStatsOpen(false);
              }}
              panelId={statsPanelId}
              toggleId={statsToggleId}
            />
          ) : null}

          <div className={styles.footer}>
            {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}

            <div className={styles.actions}>
              {mediator.canUndo() ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    mediator.undo();
                  }}
                >
                  Undo attach
                </Button>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                size="md"
                className={styles.post}
                disabled={!canPost || submit.isPending}
              >
                Post
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <section className={styles.quick}>
        <h2>Quick posts</h2>
        <div className={styles.templates}>
          {QUICK_POST_TEMPLATES.map((template) => (
            <Button
              key={template.name}
              type="button"
              variant="secondary"
              size="md"
              onClick={() => {
                // A clone, never the template: editing the draft must leave the
                // stored template exactly as it was for the next use.
                mediator.loadDraft(template.clone());
              }}
            >
              {template.name}
            </Button>
          ))}
        </div>
      </section>
    </section>
  );
}
