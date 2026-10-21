import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { useAuth } from "../../auth/AuthContext";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { useModalFlow } from "../../routes/modal-flow";
import { InlineComposer } from "../compose/InlineComposer";
import {
  FEED_KEY_ROOT,
  cacheHolds,
  fetchThread,
  threadKey,
  type FeedCacheValue,
  type PostView,
} from "../feed/api";
import { PostNode } from "../feed/PostNode";
import styles from "./ThreadModal.module.css";

/**
 * `/posts/:postId` — a post's thread, in a modal over the page it was opened
 * from (`FRONTEND-010`).
 *
 * **A route, rendered over another one.** A card links here as a step of a
 * modal flow (`routes/modal-flow.tsx`) over the page it was on, which
 * `routes/BackgroundRoutes.tsx` keeps rendered, unchanged, under this modal.
 * Opened with no origin (a reload, a shared link), the feed is underneath.
 *
 * **One flow, one modal** (`FRONTEND-011`). A reply's thread opens in this same
 * `Dialog`, which stays mounted while the details switch inside it: Back steps
 * to the previous detail, and Close and Escape leave the whole flow, back to
 * the origin as the reader left it (or to `/` with none), with focus on what
 * opened the first detail. The flow's rules are the module's, not this one's.
 *
 * **Assembled, not rebuilt.** The root and every reply are the feed's own
 * `PostNode` cards, with their controls and counts; the reply box is
 * `features/compose`'s `InlineComposer`. This feature owns only the order they
 * sit in — root, composer, then the direct replies oldest first — and the read
 * of `GET /feed/thread/{id}` (the root plus its direct replies, [[0x06-feed]]).
 * A reply's timestamp opens that reply's own thread here, in the same modal.
 *
 * **After a reply** the thread and every cached copy of the parent (the feed's
 * pages, search results, a thread that lists it as a reply) are read again, so
 * the reply count everywhere is the server's, never a guess.
 */
export function ThreadModal() {
  const { postId: raw } = useParams();
  const [searchParams] = useSearchParams();
  const postId = postIdFrom(raw);
  const { back, close } = useModalFlow();

  return (
    <Dialog open onClose={close} onBack={back} title="Thread">
      {postId === null ? (
        <NotFound />
      ) : (
        <Thread postId={postId} replying={searchParams.get("reply") === "1"} />
      )}
    </Dialog>
  );
}

/**
 * The id in the address, or `null` for anything that is not one. The address
 * is user input: a value that is not a positive integer is no post at all,
 * and is never sent to the API.
 */
function postIdFrom(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function NotFound() {
  return <EmptyState>Post not found</EmptyState>;
}

interface ThreadProps {
  postId: number;
  /** Opened by a Reply control (`?reply=1`): the reply box takes focus. */
  replying: boolean;
}

function Thread({ postId, replying }: ThreadProps) {
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const location = useLocation();
  const thread = useQuery({
    queryKey: threadKey(postId),
    queryFn: () => fetchThread(postId),
  });

  if (thread.isPending) return <StatusLine>Loading the thread…</StatusLine>;
  if (thread.isError) {
    return (
      <div className={styles.failure}>
        <InlineAlert>We could not load this thread just now.</InlineAlert>
        <Button
          type="button"
          variant="secondary"
          size="md"
          disabled={thread.isFetching}
          onClick={() => {
            void thread.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (thread.data === null) return <NotFound />;

  const { root } = thread.data;

  function refreshAfterReply(): void {
    // The exact keys that hold the parent, not the whole root prefix: every
    // other thread the reader opened is not about this reply.
    void queryClient.invalidateQueries({
      queryKey: threadKey(postId),
      exact: true,
    });
    for (const [key, value] of queryClient.getQueriesData<FeedCacheValue>({
      queryKey: FEED_KEY_ROOT,
    })) {
      if (cacheHolds(value, postId)) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true });
      }
    }
  }

  return (
    <div className={styles.thread}>
      <PostNode post={root} />

      {status === "authenticated" ? (
        <InlineComposer
          key={postId}
          parentPostId={postId}
          parentUsername={root.author.username}
          autoFocus={replying}
          onPosted={refreshAfterReply}
        />
      ) : status === "anonymous" ? (
        <p className={styles.signIn}>
          {/* `from` is what SignInPage reads to come back to this thread. */}
          <Link to="/sign-in" state={{ from: location }}>
            Sign in to reply
          </Link>
        </p>
      ) : null}

      <Replies replies={thread.data.replies} />
    </div>
  );
}

/** The direct replies, oldest first, each a post card of its own. */
function Replies({ replies }: { replies: PostView[] }) {
  if (replies.length === 0) return <EmptyState>No replies yet.</EmptyState>;
  return (
    <ol className={styles.replies} aria-label="Replies">
      {oldestFirst(replies).map((reply) => (
        <li key={reply.id}>
          <PostNode post={reply} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The API answers oldest first already; sorting here makes the order this
 * view's own promise rather than an accident of the fixture. A stable sort, so
 * replies with the same time keep the order they came in.
 */
function oldestFirst(replies: PostView[]): PostView[] {
  return [...replies].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  );
}
