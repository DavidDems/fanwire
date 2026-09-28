import { useMutation } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";

import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import { ComposeMediator } from "./ComposeMediator";
import { ComposeTextBox } from "./ComposeTextBox";
import { MediaWidget } from "./MediaWidget";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { PostBuilder } from "./PostBuilder";
import { QUICK_POST_TEMPLATES } from "./PostTemplate";

/**
 * The composer.
 *
 * It owns one `ComposeMediator` and hands it to all three controls; that is the
 * whole of the wiring between them. It owns no draft state of its own — the
 * mediator is the store, and `PostBuilder` turns whatever the mediator currently
 * holds into the request.
 *
 * **Nothing is fetched when this page mounts.** Games and teams are asked for
 * when the user types `#` or `$`, templates are stored in the app, and the media
 * poll starts at the first upload.
 *
 * **A failed `POST /posts` keeps the draft.** Losing a user's typed text on a 500
 * is the worst thing this page can do and the failure most likely to survive
 * review, because the happy path is what gets clicked. The composer is cleared in
 * exactly one place: `onSuccess`.
 */

type CreatePostRequest = components["schemas"]["CreatePostRequest"];
type PostOut = components["schemas"]["PostOut"];

async function createPost(body: CreatePostRequest): Promise<PostOut> {
  const { data, response } = await apiClient.POST("/posts", { body });
  if (!response.ok || data === undefined) {
    throw new Error(`POST /posts answered ${response.status}`);
  }
  return data;
}

export function ComposePage() {
  const mediator = useMemo(() => new ComposeMediator(), []);
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const [failure, setFailure] = useState<string | null>(null);

  // Rebuilt from the published draft on every render, so the submit control and
  // the request it sends can never disagree about what is in the composer.
  const builder = PostBuilder.from(draft);
  const canPost = builder.canBuild();

  const submit = useMutation({
    mutationFn: createPost,
    onSuccess: () => {
      setFailure(null);
      mediator.reset();
    },
    onError: () => {
      setFailure("We could not post that. Your draft is still here — please try again.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canPost) return;
    setFailure(null);
    submit.mutate(builder.build());
  }

  return (
    <section>
      <h1>Compose</h1>

      {failure === null ? null : <p role="alert">{failure}</p>}

      <form onSubmit={handleSubmit} noValidate>
        <ComposeTextBox mediator={mediator} />
        <MentionAutocomplete mediator={mediator} />
        <MediaWidget mediator={mediator} />

        {mediator.canUndo() ? (
          <button
            type="button"
            onClick={() => {
              mediator.undo();
            }}
          >
            Undo mention
          </button>
        ) : null}

        <button type="submit" disabled={!canPost || submit.isPending}>
          Post
        </button>
      </form>

      <section>
        <h2>Quick posts</h2>
        {QUICK_POST_TEMPLATES.map((template) => (
          <button
            key={template.name}
            type="button"
            onClick={() => {
              // A clone, never the template: editing the draft must leave the
              // stored template exactly as it was for the next use.
              mediator.loadDraft(template.clone());
            }}
          >
            {template.name}
          </button>
        ))}
      </section>
    </section>
  );
}
