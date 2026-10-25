import { useMutation } from "@tanstack/react-query";
import {
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";

import { Button } from "../../components/ui/Button";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { ComposeMediator } from "./ComposeMediator";
import { ComposeTextBox } from "./ComposeTextBox";
import { MediaWidget } from "./MediaWidget";
import { PostBuilder } from "./PostBuilder";
import { createPost } from "./createPost";
import styles from "./InlineComposer.module.css";

export interface InlineComposerProps {
  /** The post being replied to. */
  parentPostId: number;
  /** Its author's username, for "Replying to @username". */
  parentUsername: string;
  /** Focus the text box on arrival: the thread was opened to reply. */
  autoFocus?: boolean;
  /**
   * Called once a reply exists on the server. The caller refreshes what shows
   * it — the thread and every cached copy of the parent — because which
   * caches those are is not this feature's to know.
   */
  onPosted?: () => void;
}

/**
 * The reply box under a post in the thread modal (`FRONTEND-010`).
 *
 * **The same composer as `/compose`, not a second one.** One
 * `ComposeMediator`, opened in the reply's context, handed to the same text
 * box and media widget `ComposePage` uses, and turned into the request by the
 * same `PostBuilder`. So a reply is `POST /posts` with `is_reply: true` and the
 * parent's id, built by the code that builds every other post.
 *
 * **No Attach stats** (`FRONTEND-013`): the server refuses a `data_link` on a
 * reply (`data_link_on_reply`), so the third colleague, `AttachmentPicker`, is
 * not here, and with nothing to attach there is nothing to undo either. The
 * `#`/`$` dropdown that used to sit in its place is gone from both composers.
 *
 * **What is being replied to is said, and tied to the box.** "Replying to
 * @username" is visible above it and is the text box's `aria-describedby`, so
 * a screen reader hears it on arrival in the box, before the standing hint.
 *
 * **Never optimistic.** The draft is cleared, and `onPosted` asked to refresh
 * the counts, only once the server has the reply; a failure keeps the draft and
 * says so beside the button, as `ComposePage` does. Submit is disabled while
 * the request is in flight, so one press is one reply.
 *
 * **The image flow is `/compose`'s** (`FRONTEND-020`): the same `MediaWidget`,
 * its paperclip under the box, and Reply waits while an image is checked.
 *
 * Mounted per parent (the caller keys it), so a reply started under one post
 * never carries over to the next thread opened in the same modal.
 */
export function InlineComposer({
  parentPostId,
  parentUsername,
  autoFocus = false,
  onPosted,
}: InlineComposerProps) {
  const contextId = useId();
  const mediator = useMemo(
    () => new ComposeMediator({ replyToPostId: parentPostId }),
    [parentPostId],
  );
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const checking = useSyncExternalStore(
    mediator.subscribe,
    mediator.isMediaChecking,
  );
  const [failure, setFailure] = useState<string | null>(null);

  const builder = PostBuilder.from(draft);
  // An image still being checked holds the reply back (FRONTEND-020).
  const canPost = builder.canBuild() && !checking;

  const submit = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      setFailure(null);
      mediator.reset();
      onPosted?.();
    },
    onError: () => {
      setFailure(
        "We could not post your reply. It is still here — please try again.",
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canPost || submit.isPending) return;
    setFailure(null);
    submit.mutate(builder.build());
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <p id={contextId} className={styles.context}>
        Replying to @{parentUsername}
      </p>
      <ComposeTextBox
        mediator={mediator}
        label="Your reply"
        describedBy={contextId}
        autoFocus={autoFocus}
      />
      <MediaWidget mediator={mediator} />

      <div className={styles.footer}>
        {failure === null ? null : <InlineAlert>{failure}</InlineAlert>}
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            size="md"
            className={styles.submit}
            disabled={!canPost || submit.isPending}
          >
            Reply
          </Button>
        </div>
      </div>
    </form>
  );
}
