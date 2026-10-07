import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Avatar } from "../../components/ui/Avatar";
import { Button, buttonClass } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import {
  ChevronDownIcon,
  MessageCircleIcon,
  Repeat2Icon,
} from "../../components/ui/icons";
import { LikeButton } from "./LikeButton";
import { LiveScoreTickerDecorator } from "./LiveScoreTickerDecorator";
import { PostMedia } from "./PostMedia";
import styles from "./PostNode.module.css";
import { fetchThread, threadKey, type PostView } from "./api";

/**
 * One post — and, when a reader asks for them, its replies, which are posts and
 * are rendered by this same component.
 *
 * **Composite** ([[wiki/CodeContext/Standards/gof-patterns|GoF patterns]]): a
 * leaf and a node with children are the same thing here, so there is no second
 * component for "a thread", none for "the root" and none for "a reply". That is
 * what makes depth free — the third level costs no code the first did not
 * already need — and it is why the expand control is on *every* post rather than
 * only on the ones that have replies. A post view carries no reply count, so a
 * post cannot know whether it has any without asking; offering the control only
 * where replies exist would mean asking for every post on screen, which is the
 * eager whole-thread read the endpoint is shaped to prevent.
 *
 * **One level per request.** `GET /feed/thread/{post_id}` answers the root plus
 * its **direct** replies ([[0x06-feed]] Routes). Expanding a reply asks for that
 * reply's own id; the root's id is never asked for twice, because the answer
 * would be the same page it already has and would still not contain the deeper
 * level.
 *
 * **The card renders from the `post` it was handed**, and the thread read is
 * used only for the replies underneath it. A node that preferred the thread's
 * own copy of the root would show a post from a different cache entry than the
 * one its parent is rendering from, and the two would disagree for as long as
 * one of them was stale.
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
  const [expanded, setExpanded] = useState(false);

  // Nothing is fetched to render a post nobody has expanded — mounting a feed of
  // twenty posts would otherwise be twenty-one requests.
  const thread = useQuery({
    queryKey: threadKey(post.id),
    queryFn: () => fetchThread(post.id),
    enabled: expanded,
  });
  const replies = thread.data?.replies;

  /**
   * The post itself: who wrote it, when, what it says and what it carries. This
   * is what the decorator wraps — the controls and the replies below are the
   * reader's, not the post's.
   */
  const view = (
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
      {post.text === null ? null : <p className={styles.text}>{post.text}</p>}
      {post.media.map((item) => (
        <PostMedia key={item.id} item={item} author={post.author.username} />
      ))}
    </>
  );

  const body = (
    <>
      {post.live_scores.length === 0 ? (
        view
      ) : (
        <LiveScoreTickerDecorator post={post}>{view}</LiveScoreTickerDecorator>
      )}

      <footer className={styles.footer}>
        <LikeButton post={post} />
        {/*
         * Reply and repost are an address, never an import. `/compose` reads
         * both parameters and seeds its own draft from them; a route is the one
         * seam a feature folder can offer another without being imported by it
         * ([[0x00-architecture]] Connection rule), and this unit reimplements no
         * part of composing. They look like ghost buttons and stay links: what
         * they do is go somewhere.
         */}
        <Link
          className={buttonClass("ghost", "sm")}
          to={`/compose?reply_to=${post.id}`}
        >
          <MessageCircleIcon />
          Reply
        </Link>
        <Link
          className={buttonClass("ghost", "sm")}
          to={`/compose?repost_of=${post.id}`}
        >
          <Repeat2Icon />
          Repost
        </Link>
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
          {thread.isPending ? <StatusLine>Loading replies…</StatusLine> : null}
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
