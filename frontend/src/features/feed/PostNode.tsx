import { format, parseISO } from "date-fns";
import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Avatar } from "../../components/ui/Avatar";
import { Card } from "../../components/ui/Card";
import {
  HeartFilledIcon,
  HeartIcon,
  MessageCircleIcon,
  Repeat2FilledIcon,
  Repeat2Icon,
} from "../../components/ui/icons";
import { useDetailLinkState } from "../../routes/modal-flow";
import { PostAction, TogglePostAction } from "./PostAction";
import { PostMedia } from "./PostMedia";
import { PostMenu } from "./PostMenu";
import styles from "./PostNode.module.css";
import { PostText } from "./PostText";
import { LinkPreview } from "./previews/LinkPreview";
import {
  isPlainRepost,
  setLiked,
  setReposted,
  withLike,
  withRepost,
  type PostView,
} from "./api";
import { likesText, repliesText, repostsText } from "./counts";

/**
 * One post card — in the feed, in search results, and in the thread modal,
 * where the root and each of its replies is one of these.
 *
 * **Composite** ([[wiki/CodeContext/Standards/gof-patterns|GoF patterns]]): a
 * root and a reply are the same thing here, so there is no second component
 * for "the root" and none for "a reply". Since `FRONTEND-010` the thread is not
 * expanded inside the card: the thread modal (`features/thread/`) at
 * `/posts/:id` shows the root's card and its direct replies' cards, and a
 * reply's card opens that reply's own thread in the same modal. The card
 * itself fetches nothing.
 *
 * **How a card opens its thread.** The timestamp is a link to `/posts/<id>`:
 * the keyboard and screen-reader path. A click anywhere else on the card that
 * is not on a link, a button or a field, and is not the end of a text
 * selection, opens the same thread — a mouse convenience, not a second focus
 * stop, so the card has no `tabindex` and is never wrapped in a link. The reply
 * count is a link to the thread too, and Reply opens it to reply
 * (`/posts/<id>?reply=1`). Every one of them carries the modal flow's state
 * from `routes/modal-flow.tsx`: on a page it starts a flow over that page,
 * which is what keeps the page rendered under the modal; inside the modal it
 * is the next detail of the same flow, so Close still returns to that page.
 *
 * **A repost is rendered as what it is** (UI-009). A *plain* repost — no text
 * and no media of its own — stands for the original: a line naming who
 * reposted it, then the original's own card built from `reposted_post`, whose
 * controls, counts and thread are the original's. A *quote* repost is a post
 * of its own, with the original inside it as a compact box without controls,
 * linked to the original's own thread. Either way it is this one node choosing
 * what to render, not a second component.
 *
 * **A post's data link is shown as what it links to** (`FRONTEND-014`): a game
 * result, a player's game line or a career, from `./previews`, each with its
 * one link to its detail. That link is its own tab stop, never inside the
 * timestamp's or Reply's, and the card's click-to-open ignores it as it does
 * every link. A plain repost shows the original's preview; a quote shows its
 * own, and the original's inside the original's box.
 *
 * **The card renders from the `post` it was handed** (for a plain repost, from
 * the `reposted_post` inside it), never from another cache entry's copy of it.
 *
 * **Every card has one "More options" menu** (`FRONTEND-012`, `./PostMenu`) at
 * the end of its action row: Copy link, Report, the owner's Delete. A plain
 * repost's acts on the original, and never offers Delete; a quote's original
 * box has none of its own.
 *
 * **An original its owner deleted** (`reposted_post_deleted`, `POSTS-004`) is
 * a muted "Post deleted" card in its place, on a plain repost and in a quote
 * alike: nothing of it is shown, and nothing links to it. An original that is
 * merely hidden (its author deactivated) still reads "This post is
 * unavailable".
 */

export interface PostNodeProps {
  post: PostView;
}

/** The address of a post's thread, or of the thread opened to reply. */
function threadPath(postId: number, reply = false): string {
  return `/posts/${postId}${reply ? "?reply=1" : ""}`;
}

/**
 * The mouse convenience: a click on a card's own surface opens a thread.
 * Links, buttons and fields keep their own clicks, and a click that ends a text
 * selection is the reader selecting, not opening.
 */
function useOpenThreadOnClick(postId: number) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const state = useDetailLinkState();
  return (event: MouseEvent<HTMLElement>): void => {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a, button, input, textarea, select, label") !== null) {
      return;
    }
    // The card's own menu and confirms: a click in them is never the card's.
    // Only ones inside this card, since the card itself may be in the modal.
    const inner = target.closest('dialog, [role="menu"]');
    if (inner !== null && event.currentTarget.contains(inner)) return;
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    // Marked handled, so the card around a quote's original does not open
    // its own thread as well.
    event.preventDefault();
    // Already open (the root's own card in the modal): a second entry for the
    // same thread would be a step of the flow that shows nothing new.
    if (pathname === threadPath(postId)) return;
    navigate(threadPath(postId), { state });
  };
}

export function PostNode({ post }: PostNodeProps) {
  const plain = isPlainRepost(post);
  // The post this card is about: what its header, text, controls and thread
  // belong to. For a plain repost that is the original, or nothing at all.
  const subject = plain ? post.reposted_post : post;
  const state = useDetailLinkState();
  const openThread = useOpenThreadOnClick(subject?.id ?? post.id);

  const repostedBy = !plain ? null : (
    <p className={styles.reposted}>
      <Repeat2Icon size={16} />{" "}
      <Link className={styles.reposter} to={`/profile/${post.author.id}`}>
        {post.author.username}
      </Link>{" "}
      reposted
    </p>
  );

  const body =
    subject === null ? (
      <>
        {repostedBy}
        <MissingOriginal deleted={post.reposted_post_deleted} />
        <footer className={styles.footer}>
          <PostMenu post={post} deletable={false} reportable={false} />
        </footer>
      </>
    ) : (
      <>
        {repostedBy}
        <PostContent post={subject} />
        {/*
         * Only a quote reached directly shows its original. The API sends
         * `reposted_post` one level deep, so a plain repost *of* a quote carries
         * the quote with its own `reposted_post` always null — the depth cut,
         * not an unavailable original — and the box is left out rather than
         * claiming the original is gone.
         */}
        {!plain && subject.is_repost ? (
          <QuotedPost
            post={subject.reposted_post}
            deleted={subject.reposted_post_deleted}
          />
        ) : null}

        {/*
         * The reader's controls, under the content: like, reply and repost,
         * each followed by its count. For a plain repost every one of them acts
         * on the original.
         */}
        <footer className={styles.footer}>
          <TogglePostAction
            postId={subject.id}
            label="Like"
            pressed={subject.liked_by_viewer}
            count={likesText(subject)}
            icon={<HeartIcon />}
            pressedIcon={<HeartFilledIcon />}
            send={setLiked}
            apply={withLike}
          />
          {/*
           * Reply is an address, never an import: the thread modal opened to
           * reply, whose composer is `features/compose`'s and is put beside
           * this card by `features/thread`, neither of which this folder
           * imports ([[0x00-architecture]] Connection rule). It looks like the
           * two toggles and stays a link: what it does is go somewhere. Its
           * count links to the same thread, and moves only once a reply exists
           * and the post is read again, never on the click.
           */}
          <PostAction
            label="Reply"
            to={threadPath(subject.id, true)}
            countTo={threadPath(subject.id)}
            state={state}
            icon={<MessageCircleIcon />}
            count={repliesText(subject)}
          />
          <TogglePostAction
            postId={subject.id}
            label="Repost"
            pressed={subject.reposted_by_viewer}
            count={repostsText(subject)}
            icon={<Repeat2Icon />}
            pressedIcon={<Repeat2FilledIcon />}
            send={setReposted}
            apply={withRepost}
          />
          <PostMenu post={subject} deletable={!plain} reportable />
        </footer>
      </>
    );

  // `article` is the role for a self-contained composition, which is the one
  // thing a post can honestly claim. The click is a mouse shortcut to what the
  // timestamp link already offers, so the card takes no role or tabindex for it.
  return (
    <Card as="article" className={styles.post} onClick={openThread}>
      {body}
    </Card>
  );
}

/**
 * The post itself: who wrote it, when, what it says and what it carries. The
 * controls below it are the reader's, not the post's.
 */
function PostContent({ post }: { post: PostView }) {
  return (
    <>
      <header className={styles.header}>
        <Avatar
          username={post.author.username}
          size="sm"
          avatarKey={post.author.profile_avatar_key}
          pictureKey={post.author.profile_picture_key}
        />
        <Link className={styles.author} to={`/profile/${post.author.id}`}>
          {post.author.username}
        </Link>
        <ThreadTimeLink post={post} />
      </header>
      {post.text === null || post.text === "" ? null : (
        <PostText
          className={styles.text}
          text={post.text}
          mentionedGameIds={post.mentioned_game_ids}
        />
      )}
      <LinkPreview post={post} />
      {post.media.map((item) => (
        <PostMedia key={item.id} item={item} author={post.author.username} />
      ))}
    </>
  );
}

/**
 * The original inside a quote repost: a compact, bordered card with its author,
 * time and text clamped to a few lines, and no controls — the controls on a
 * quote are the quote's own.
 */
function QuotedPost({
  post,
  deleted,
}: {
  post: PostView | null;
  deleted: boolean;
}) {
  if (post === null) return <MissingOriginal deleted={deleted} />;
  return <QuotedOriginal post={post} />;
}

/**
 * Where an original that cannot be shown would be: "Post deleted" when its
 * owner deleted it, "This post is unavailable" when it is hidden (its author
 * deactivated). Plain text in a muted box, not a link or a control: there is
 * nothing of it left to open.
 */
function MissingOriginal({ deleted }: { deleted: boolean }) {
  return (
    <div className={`${styles.quoted} ${styles.missing}`}>
      <p className={styles.unavailable}>
        {deleted ? "Post deleted" : "This post is unavailable"}
      </p>
    </div>
  );
}

/**
 * The original, present: its author's profile, and its time as a link to its
 * own thread. A click anywhere else in the box opens that thread too — the
 * original's, not the quote's around it.
 */
function QuotedOriginal({ post }: { post: PostView }) {
  const openThread = useOpenThreadOnClick(post.id);
  return (
    <div className={styles.quoted} onClick={openThread}>
      <p className={styles.quotedHeader}>
        <Link className={styles.author} to={`/profile/${post.author.id}`}>
          {post.author.username}
        </Link>
        <ThreadTimeLink post={post} />
      </p>
      {post.text === null || post.text === "" ? null : (
        <PostText
          className={styles.quotedText}
          text={post.text}
          mentionedGameIds={post.mentioned_game_ids}
        />
      )}
      <LinkPreview post={post} />
    </div>
  );
}

/** A post's time, as the link to its thread: the keyboard path to it. */
function ThreadTimeLink({ post }: { post: PostView }) {
  const state = useDetailLinkState();
  return (
    <Link className={styles.timeLink} to={threadPath(post.id)} state={state}>
      <time className={styles.time} dateTime={post.created_at}>
        {postedOn(post.created_at)}
      </time>
    </Link>
  );
}

/**
 * The same format the rest of the app dates things in, and deliberately not a
 * relative "3 hours ago": that re-renders into a different string as the page
 * ages, and two readers looking at the same feed a minute apart would be
 * comparing different text for the same post.
 */
function postedOn(value: string): string {
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : format(parsed, "d MMM yyyy, HH:mm");
}
