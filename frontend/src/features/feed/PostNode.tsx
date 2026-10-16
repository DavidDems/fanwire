import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  ChevronDownIcon,
  HeartFilledIcon,
  HeartIcon,
  MessageCircleIcon,
  Repeat2FilledIcon,
  Repeat2Icon,
} from "../../components/ui/icons";
import { PostAction, TogglePostAction } from "./PostAction";
import { PostMedia } from "./PostMedia";
import styles from "./PostNode.module.css";
import { PostText } from "./PostText";
import {
  fetchThread,
  setLiked,
  setReposted,
  threadKey,
  withLike,
  withRepost,
  type PostView,
} from "./api";
import { likesText, repliesText, repostsText } from "./counts";

/**
 * One post — and, when a reader asks for them, its replies, which are posts and
 * are rendered by this same component.
 *
 * **Composite** ([[wiki/CodeContext/Standards/gof-patterns|GoF patterns]]): a
 * leaf and a node with children are the same thing here, so there is no second
 * component for "a thread", none for "the root" and none for "a reply". That is
 * what makes depth free — the third level costs no code the first did not
 * already need — and it is why the expand control is on *every* post rather than
 * only on the ones that have replies. A post view now carries `reply_count`,
 * but the "Show replies" disclosure is kept as it was until `FRONTEND-010`
 * replaces it with the thread view; it still asks for nothing until it is used.
 *
 * **One level per request.** `GET /feed/thread/{post_id}` answers the root plus
 * its **direct** replies ([[0x06-feed]] Routes). Expanding a reply asks for that
 * reply's own id; the root's id is never asked for twice, because the answer
 * would be the same page it already has and would still not contain the deeper
 * level.
 *
 * **A repost is rendered as what it is** (UI-009). A *plain* repost — no text
 * and no media of its own — stands for the original: a line naming who
 * reposted it, then the original's own card built from `reposted_post`, whose
 * controls, counts and replies are the original's. A *quote* repost is a post
 * of its own, with the original inside it as a compact card without controls.
 * Either way it is this one node choosing what to render, not a second
 * component.
 *
 * **The card renders from the `post` it was handed** (for a plain repost, from
 * the `reposted_post` inside it), and the thread read is used only for the
 * replies underneath it. A node that preferred the thread's own copy of the
 * root would show a post from a different cache entry than the one its parent
 * is rendering from, and the two would disagree for as long as one of them was
 * stale.
 *
 * **Only the top level is a card** (`layout.md` §4). A reply is the same node
 * with `nested` set, which changes nothing but the box: it renders as a plain
 * `<article>` on its parent card's surface, so a thread reads as one card with
 * a line down its side rather than as cards inside cards.
 */

export interface PostNodeProps {
  post: PostView;
  /** Set by the recursion on every reply: a reply sits inside its parent's card. */
  nested?: boolean;
}

export function PostNode({ post, nested = false }: PostNodeProps) {
  const plain = isPlainRepost(post);
  // The post this card is about: what its header, text, controls and replies
  // belong to. For a plain repost that is the original, or nothing at all.
  const subject = plain ? post.reposted_post : post;
  const subjectId = subject?.id ?? post.id;
  const [expanded, setExpanded] = useState(false);

  // Nothing is fetched to render a post nobody has expanded — mounting a feed of
  // twenty posts would otherwise be twenty-one requests.
  const thread = useQuery({
    queryKey: threadKey(subjectId),
    queryFn: () => fetchThread(subjectId),
    enabled: expanded && subject !== null,
  });
  const replies = thread.data?.replies;

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
        <p className={styles.unavailable}>This post is unavailable</p>
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
          <QuotedPost post={subject.reposted_post} />
        ) : null}

        {/*
         * The reader's controls, under the content: like, reply and repost,
         * each followed by its count, then the replies disclosure. For a plain
         * repost every one of them acts on the original.
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
           * Reply is an address, never an import. `/compose` reads `reply_to`
           * and seeds its own draft from it; a route is the one seam a feature
           * folder can offer another without being imported by it
           * ([[0x00-architecture]] Connection rule), and this unit reimplements
           * no part of composing. It looks like the two toggles and stays a
           * link: what it does is go somewhere. Its count moves only once a
           * reply exists and the post is read again, never on the click.
           */}
          <PostAction
            label="Reply"
            to={`/compose?reply_to=${subject.id}`}
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
          {/*
           * A disclosure button: the label stays put and `aria-expanded` is what
           * carries the state, so the control a reader learned once does not
           * rename itself under them every time they use it. The chevron turning
           * over is that same attribute, read by CSS.
           */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={styles.toggle}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            Show replies
            <ChevronDownIcon className={styles.chevron} />
          </Button>
        </footer>

        {!expanded ? null : (
          <div className={styles.thread}>
            {thread.isPending ? (
              <StatusLine>Loading replies…</StatusLine>
            ) : null}
            {thread.isError ? (
              <InlineAlert>
                We could not load these replies just now. Please try again.
              </InlineAlert>
            ) : null}
            {/*
             * An answered thread with no replies says so: an expanded post that
             * showed nothing would read as a control that did nothing.
             */}
            {replies === undefined ? null : replies.length === 0 ? (
              <EmptyState>No replies yet.</EmptyState>
            ) : (
              <ol className={styles.replies}>
                {replies.map((reply) => (
                  <li key={reply.id}>
                    <PostNode post={reply} nested />
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </>
    );

  // `article` is the role for a self-contained composition, which is the one
  // thing a post can honestly claim — and it nests, which a thread needs.
  return nested ? (
    <article className={styles.post}>{body}</article>
  ) : (
    <Card as="article" className={styles.post}>
      {body}
    </Card>
  );
}

/**
 * A repost with nothing of its own to say stands for the original. A repost
 * with text or media is a quote, and a post in its own right.
 */
function isPlainRepost(post: PostView): boolean {
  return (
    post.is_repost &&
    (post.text === null || post.text === "") &&
    post.media.length === 0
  );
}

/**
 * The post itself: who wrote it, when, what it says and what it carries. The
 * controls and the replies below it are the reader's, not the post's.
 */
function PostContent({ post }: { post: PostView }) {
  return (
    <>
      <header className={styles.header}>
        <Avatar username={post.author.username} size="sm" />
        <Link className={styles.author} to={`/profile/${post.author.id}`}>
          {post.author.username}
        </Link>
        <time className={styles.time} dateTime={post.created_at}>
          {postedOn(post.created_at)}
        </time>
      </header>
      {post.text === null || post.text === "" ? null : (
        <PostText
          className={styles.text}
          text={post.text}
          mentionedGameIds={post.mentioned_game_ids}
        />
      )}
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
function QuotedPost({ post }: { post: PostView | null }) {
  if (post === null) {
    return (
      <div className={styles.quoted}>
        <p className={styles.unavailable}>This post is unavailable</p>
      </div>
    );
  }
  return (
    <div className={styles.quoted}>
      <p className={styles.quotedHeader}>
        {/*
         * FRONTEND-010 replaces this with a link to the original post itself
         * (`/posts/:id`). Until that route exists, the original author's
         * profile is the nearest page that shows it.
         */}
        <Link className={styles.author} to={`/profile/${post.author.id}`}>
          {post.author.username}
        </Link>
        <time className={styles.time} dateTime={post.created_at}>
          {postedOn(post.created_at)}
        </time>
      </p>
      {post.text === null || post.text === "" ? null : (
        <PostText
          className={styles.quotedText}
          text={post.text}
          mentionedGameIds={post.mentioned_game_ids}
        />
      )}
    </div>
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
