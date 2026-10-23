import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useAccount } from "../../auth/account";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { EllipsisIcon } from "../../components/ui/icons";
import { Menu, type MenuItem } from "../../components/ui/Menu";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  FEED_KEY_ROOT,
  PostRequestError,
  cacheHolds,
  deletePost,
  reportPost,
  threadKey,
  withoutPost,
  type FeedCacheValue,
  type PostView,
} from "./api";
import styles from "./PostMenu.module.css";
import { useReported } from "./reported";

/**
 * A post card's "More options" menu (`FRONTEND-012`; `business-rules.md`'s
 * "Copy link and Report through hamburger option"), on `components/ui/Menu`.
 *
 * | item      | offered to                                                     |
 * |-----------|----------------------------------------------------------------|
 * | Copy link | everyone                                                       |
 * | Report    | an active member, on someone else's post ("Reported" once sent) |
 * | Delete    | an active member, on their own post, never on a plain repost   |
 *
 * Who is who is `useAccount()`'s answer, never derived here: a guest and a
 * deactivated account get Copy link only, and ownership is `post.author.id`
 * against the active account's profile id (the server checks it again, and
 * answers a stale client 403).
 *
 * **Report and Delete ask first**, in a `ConfirmDialog` (an `alertdialog`).
 * Rendered beside the menu, not inside it, so the confirm's keys are not the
 * menu's; inside the thread modal it opens over the modal, and its Escape
 * closes only it (`Dialog`'s nested rule). Closing it puts focus back on the
 * menu button.
 *
 * **A deleted post leaves at once**, from every cache entry under
 * `FEED_KEY_ROOT` that holds it (the feed's pages, search results, threads,
 * the reposts of it), then those entries — and the parent's, whose reply
 * count just changed — are read again. `features/feed` imports none of the
 * features that cache posts: they all keep them under the feed's root.
 *
 * **Focus does not fall to the page** when the card goes with its menu
 * button: it moves to the next card's "More options" in the same list, else
 * the previous card's, else the list's heading; inside the thread modal, the
 * root's, and for the root itself the modal's Close. Found through the DOM
 * from where the card sits (`focusAfterDeleting`), so no list passes props for
 * it and this folder still imports none of them.
 */
export interface PostMenuProps {
  /** The post the menu acts on: for a plain repost, the original. */
  post: PostView;
  /** False on a plain repost's card: removing that is Undo repost, not Delete. */
  deletable: boolean;
  /** False where the card shows no post at all (an original that is gone). */
  reportable: boolean;
}

type Confirming = "report" | "delete" | null;

type Copied = { state: "copied" } | { state: "manual"; address: string } | null;

export function PostMenu({ post, deletable, reportable }: PostMenuProps) {
  const account = useAccount();
  const queryClient = useQueryClient();
  const { reported, markReported } = useReported(post.id);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState<Copied>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const own =
    account.status === "active" && post.author.id === account.profile.id;
  const canReport = reportable && account.status === "active" && !own;
  const canDelete = deletable && own;

  const report = useMutation({
    mutationFn: () => reportPost(post.id),
    onSuccess: () => {
      markReported();
      setConfirming(null);
    },
    onError: () => {
      setFailure("We could not send your report just now. Please try again.");
    },
  });

  const remove = useMutation({
    mutationFn: () => deletePost(post.id),
    onSuccess: async () => {
      // Where focus goes once the card has gone, found while it is still here.
      const anchor = anchorRef.current;
      const next = anchor === null ? null : focusAfterDeleting(anchor);
      setConfirming(null);
      await forgetDeletedPost(queryClient, post);
      if (anchor !== null && next !== null) focusWhenGone(anchor, next);
    },
    onError: (error) => {
      setFailure(deleteFailure(error));
    },
  });

  async function copyLink(): Promise<void> {
    const address = `${window.location.origin}/posts/${post.id}`;
    setCopied(null);
    // Missing outside a secure context, and in jsdom.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    try {
      if (clipboard === undefined) throw new Error("No clipboard here.");
      await clipboard.writeText(address);
      setCopied({ state: "copied" });
    } catch {
      // Refused or unavailable: the address itself, ready to copy by hand.
      setCopied({ state: "manual", address });
    }
  }

  function ask(next: Confirming): void {
    setFailure(null);
    setConfirming(next);
  }

  const items: MenuItem[] = [
    {
      label: "Copy link",
      onSelect: () => {
        void copyLink();
      },
    },
  ];
  if (canReport) {
    items.push(
      reported
        ? { label: "Reported", onSelect: () => {}, disabled: true }
        : { label: "Report", onSelect: () => ask("report") },
    );
  }
  if (canDelete) items.push({ label: "Delete", onSelect: () => ask("delete") });

  return (
    <>
      <div ref={anchorRef} className={styles.menu}>
        <Menu label="More options" items={items} icon={<EllipsisIcon />} />
      </div>

      {copied === null ? null : (
        <div className={styles.feedback}>
          {copied.state === "copied" ? (
            <StatusLine variant="success">Link copied</StatusLine>
          ) : (
            <ManualCopy address={copied.address} />
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirming === "report"}
        title="Report this post?"
        confirmLabel="Report"
        onConfirm={() => {
          setFailure(null);
          report.mutate();
        }}
        onCancel={() => ask(null)}
        pending={report.isPending}
        failure={failure}
      >
        <p>It is flagged as reported. You can report a post once.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "delete"}
        title="Delete this post?"
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setFailure(null);
          remove.mutate();
        }}
        onCancel={() => ask(null)}
        pending={remove.isPending}
        failure={failure}
      >
        <p>
          It goes from every feed, search and profile, and cannot be brought
          back. Replies to it stay, under &ldquo;Post deleted&rdquo;.
        </p>
      </ConfirmDialog>
    </>
  );
}

/**
 * The address, when the clipboard refused it or there is none: a read-only
 * field, focused and wholly selected, so one copy keystroke takes it. Never a
 * silent failure, and never "Link copied" for a copy that did not happen.
 */
function ManualCopy({ address }: { address: string }) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const field = ref.current;
    if (field === null) return;
    field.focus();
    field.select();
  }, [address]);

  return (
    <label className={styles.manual}>
      <span className={styles.manualLabel}>Copy this link</span>
      <input
        ref={ref}
        className={styles.address}
        type="text"
        readOnly
        value={address}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
      />
    </label>
  );
}

/** What a refused delete says: each of the route's refusals by name. */
function deleteFailure(error: Error): string {
  const status = error instanceof PostRequestError ? error.status : null;
  if (status === 403) return "This post is not yours, so it cannot be deleted.";
  if (status === 404)
    return "This post could not be found. It may already be gone.";
  if (status === 409) {
    return "A repost is removed with Undo repost, not deleted.";
  }
  return "We could not delete this post just now. Please try again.";
}

/**
 * Take a deleted post out of every cached copy at once, then read those
 * copies again, the open thread among them.
 *
 * The keys to read again are found before the edit, while the post is still
 * in them, with the parent's (its reply count moved) and the post's own
 * thread beside them. In-flight reads are cancelled first, as the toggles do:
 * one that landed after the edit would put the post back.
 */
async function forgetDeletedPost(
  queryClient: ReturnType<typeof useQueryClient>,
  post: PostView,
): Promise<void> {
  await queryClient.cancelQueries({ queryKey: FEED_KEY_ROOT });

  const parentId = post.parent_post_id;
  const stale = queryClient
    .getQueriesData<FeedCacheValue>({ queryKey: FEED_KEY_ROOT })
    .filter(
      ([, value]) =>
        cacheHolds(value, post.id) ||
        (parentId !== null && cacheHolds(value, parentId)),
    )
    .map(([key]) => key);

  queryClient.setQueriesData<FeedCacheValue>(
    { queryKey: FEED_KEY_ROOT },
    (value) => withoutPost(value, post.id),
  );

  for (const key of [...stale, threadKey(post.id)]) {
    void queryClient.invalidateQueries({ queryKey: key, exact: true });
  }
}

/** A card's own "More options" button: a quote's original box has none. */
const MENU_BUTTON = 'button[aria-haspopup="menu"]';

/**
 * Where focus goes after the card holding `anchor` (its menu) is deleted,
 * read while that card is still on the page.
 *
 * | the card                      | focus goes to                                  |
 * |-------------------------------|------------------------------------------------|
 * | in a list, with a next card   | the next card's "More options"                 |
 * | in a list, the last one       | the previous card's                            |
 * | alone in a page's list        | the list's heading (`tabindex="-1"` if needed) |
 * | alone in the thread's replies | the root's, if it is still there               |
 * | not in a list (thread's root) | the modal's Close, else its title              |
 *
 * `null` where none of these exists: the browser's own fallback stands.
 */
function focusAfterDeleting(anchor: HTMLElement): HTMLElement | null {
  const card = anchor.closest("article");
  const item = card?.parentElement ?? null;
  const dialog = anchor.closest("dialog");

  if (item instanceof HTMLLIElement && item.parentElement !== null) {
    const list = item.parentElement;
    const sibling =
      menuButtonIn(item.nextElementSibling) ??
      menuButtonIn(item.previousElementSibling);
    if (sibling !== null) return sibling;
    if (dialog === null) {
      // The page's list leaves with its last card; its section's heading stays.
      return focusableHeading(list.closest("section")?.querySelector("h1, h2"));
    }
    const root = Array.from(
      dialog.querySelectorAll<HTMLElement>(MENU_BUTTON),
    ).find((button) => !list.contains(button));
    if (root !== undefined) return root;
  }

  if (dialog === null) return null;
  // The first Close in it is the dialog's own, in its header.
  const close = dialog.querySelector<HTMLElement>('button[aria-label="Close"]');
  if (close !== null) return close;
  const titleId = dialog.getAttribute("aria-labelledby");
  return focusableHeading(
    titleId === null ? null : document.getElementById(titleId),
  );
}

function menuButtonIn(item: Element | null): HTMLElement | null {
  return item?.querySelector<HTMLElement>(MENU_BUTTON) ?? null;
}

/** A heading made able to take focus from script, never put in the tab order. */
function focusableHeading(
  heading: Element | null | undefined,
): HTMLElement | null {
  if (!(heading instanceof HTMLElement)) return null;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

/**
 * Focus `target` once `anchor` has left the page, if focus went with it.
 *
 * Watched rather than done at once: the card leaves on react-query's render
 * after the cache edit, and closing the confirm first puts focus back on the
 * menu button, which then leaves with the card. A reader who has already moved
 * focus somewhere else keeps it there.
 */
function focusWhenGone(anchor: HTMLElement, target: HTMLElement): void {
  const settle = (): boolean => {
    if (anchor.isConnected) return false;
    const current = document.activeElement;
    const lost =
      current === null || current === document.body || !current.isConnected;
    if (lost && target.isConnected) target.focus();
    return true;
  };
  if (settle()) return;
  const observer = new MutationObserver(() => {
    if (settle()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
