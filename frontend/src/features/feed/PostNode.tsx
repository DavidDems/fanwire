import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Link } from "react-router-dom";

import { LikeButton } from "./LikeButton";
import { LiveScoreTickerDecorator } from "./LiveScoreTickerDecorator";
import { PostMedia } from "./PostMedia";
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
 */

export interface PostNodeProps {
  post: PostView;
}

export function PostNode({ post }: PostNodeProps) {
  const [expanded, setExpanded] = useState(false);

  // Nothing is fetched to render a post nobody has expanded — mounting a feed of
  // twenty posts would otherwise be twenty-one requests.
  const thread = useQuery({
    queryKey: threadKey(post.id),
    queryFn: () => fetchThread(post.id),
    enabled: expanded,
  });

  /**
   * The post itself: who wrote it, when, what it says and what it carries. This
   * is what the decorator wraps — the controls and the replies below are the
   * reader's, not the post's.
   */
  const view = (
    <>
      <header>
        <Link to={`/profile/${post.author.id}`}>{post.author.username}</Link>{" "}
        <time dateTime={post.created_at}>{postedOn(post.created_at)}</time>
      </header>
      {post.text === null ? null : <p>{post.text}</p>}
      {post.media.map((item) => (
        <PostMedia key={item.id} item={item} author={post.author.username} />
      ))}
    </>
  );

  return (
    // `article` is the role for a self-contained composition, which is the one
    // thing a post can honestly claim — and it nests, which a thread needs.
    <article>
      {post.live_scores.length === 0 ? (
        view
      ) : (
        <LiveScoreTickerDecorator post={post}>{view}</LiveScoreTickerDecorator>
      )}

      <footer>
        <LikeButton post={post} />
        {/*
         * Reply and repost are an address, never an import. `/compose` reads
         * both parameters and seeds its own draft from them; a route is the one
         * seam a feature folder can offer another without being imported by it
         * ([[0x00-architecture]] Connection rule), and this unit reimplements no
         * part of composing.
         */}
        <Link to={`/compose?reply_to=${post.id}`}>Reply</Link>{" "}
        <Link to={`/compose?repost_of=${post.id}`}>Repost</Link>{" "}
        {/*
         * A disclosure button: the label stays put and `aria-expanded` is what
         * carries the state, so the control a reader learned once does not
         * rename itself under them every time they use it.
         */}
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          Show replies
        </button>
      </footer>

      {!expanded ? null : (
        <div>
          {thread.isPending ? <p role="status">Loading replies…</p> : null}
          {thread.isError ? (
            <p role="alert">We could not load these replies just now. Please try again.</p>
          ) : null}
          {thread.data === undefined || thread.data.replies.length === 0 ? null : (
            <ol>
              {thread.data.replies.map((reply) => (
                <li key={reply.id}>
                  <PostNode post={reply} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
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
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, "d MMM yyyy, HH:mm");
}
