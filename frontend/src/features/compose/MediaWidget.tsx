import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";

import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import { Field, describeField } from "../../components/FormField";
import { Button } from "../../components/ui/Button";
import { ImageIcon } from "../../components/ui/icons";
import { InlineAlert } from "../../components/ui/InlineAlert";
import { StatusLine } from "../../components/ui/StatusLine";
import { config } from "../../config";
import type { ComposeMediator } from "./ComposeMediator";
import styles from "./MediaWidget.module.css";

/**
 * The media widget: choose a file, get it to the bucket, wait for the pipeline,
 * attach it to the draft.
 *
 * **The file bytes never pass through the API.** `POST /media/uploads` returns a
 * presigned POST — `upload_url`, `fields` and `max_bytes` — and the browser then
 * submits a multipart form straight to the bucket ([[0x04-media]] "API routes").
 * That request is a plain `fetch`, deliberately *not* `apiClient`: `apiClient`
 * attaches the Cognito ID token and the `/api` base URL, so using it here would
 * send our token to S3 and send the upload to the wrong origin.
 *
 * It reports to the mediator and reads the mediator's draft. It imports neither
 * of the other two compose controls.
 */

type CreateUploadResponse = components["schemas"]["CreateUploadResponse"];
type MediaOut = components["schemas"]["MediaOut"];
type MediaStatus = components["schemas"]["MediaStatus"];

/**
 * [[0x04-media]] "Security requirements": jpeg, png and webp only, SVG excluded
 * by name because it can carry script.
 *
 * This check is for the message the user sees, nothing more — S3's own policy
 * and the processing Lambda's Pillow parse are the real gates, and they run
 * whatever this file believes. It is still worth getting right, because it is the
 * only one of the three that can explain itself.
 */
const ALLOWED_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * How often the pipeline is asked whether it has finished.
 *
 * Short, because the user is waiting and the poll stops at a terminal status.
 * Driven by react-query's own `refetchInterval` rather than a timer this file
 * owns, so unmounting the widget cancels it.
 */
const POLL_INTERVAL_MS = 300;

const FILE_FIELD_ID = "compose-media";

/** The one failure that needs to name a number back to the user. */
class UploadTooLarge extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`The chosen file is larger than ${maxBytes} bytes.`);
    this.name = "UploadTooLarge";
    this.maxBytes = maxBytes;
  }
}

/** The ticket. This one *does* go through `apiClient`, so it carries the token. */
async function requestUploadTicket(
  mimeType: string,
): Promise<CreateUploadResponse> {
  const { data, response } = await apiClient.POST("/media/uploads", {
    body: { mime_type: mimeType },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`POST /media/uploads answered ${response.status}`);
  }
  return data;
}

/**
 * The multipart POST to the bucket.
 *
 * A plain `fetch`, and **no `Authorization` header**: the bucket has no use for
 * our ID token and sending it there would leak it. No `Content-Type` header
 * either — `fetch` derives it from the `FormData`, and setting it by hand would
 * override the boundary the body was actually written with.
 *
 * **The presigned fields go first, in the order the API returned them, and the
 * file goes last**, because S3 ignores everything that follows the `file` part.
 * `FormData` serializes in insertion order, so appending in that order is the
 * whole of it; `MediaWidget.test.tsx` asserts the order that reaches the bucket
 * rather than trusting this comment.
 */
async function uploadToBucket(
  ticket: CreateUploadResponse,
  file: File,
): Promise<void> {
  const body = new FormData();
  for (const [name, value] of Object.entries(ticket.fields))
    body.append(name, value);
  body.append("file", file);

  const response = await fetch(ticket.upload_url, { method: "POST", body });
  if (!response.ok) {
    throw new Error(`The upload answered ${response.status}`);
  }
}

async function fetchMedia(mediaId: number): Promise<MediaOut> {
  const { data, response } = await apiClient.GET("/media/{media_id}", {
    params: { path: { media_id: mediaId } },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`GET /media/${mediaId} answered ${response.status}`);
  }
  return data;
}

/** `processed` and `rejected` are the ends of the chain; there is nothing to wait for. */
function isSettled(status: MediaStatus | undefined): boolean {
  return status === "processed" || status === "rejected";
}

/**
 * The served thumbnail's URL.
 *
 * `URL.createObjectURL` is not used anywhere in this widget, and the reason is
 * not that jsdom lacks it — the served image is what everyone else will see once
 * the post is published, EXIF-stripped and resized by the pipeline, rather than
 * the original off the user's disk. So this is a product decision, not a harness
 * one, and it does not become a candidate for the kind of `setupTests.ts`
 * polyfill that `Blob`'s missing readers needed.
 */
function thumbnailUrl(key: string): string {
  return `${config.mediaBaseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

export interface MediaWidgetProps {
  mediator: ComposeMediator;
}

export function MediaWidget({ mediator }: MediaWidgetProps) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const resetCount = useSyncExternalStore(
    mediator.subscribe,
    mediator.getResetCount,
  );

  const [fileName, setFileName] = useState<string | null>(null);
  const [mediaId, setMediaId] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // Clearing the composer clears the attachment with it. The draft alone
    // cannot say this happened — an emptied draft and a never-filled one are the
    // same value — so the reset counter is what the widget watches. Without it a
    // successful post leaves a stale thumbnail sitting over an empty composer.
    setFileName(null);
    setMediaId(null);
    setFailure(null);
  }, [resetCount]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const ticket = await requestUploadTicket(file.type);
      // `max_bytes` only exists in the ticket, so this check necessarily comes
      // after it — and necessarily before a single byte goes to the bucket.
      if (file.size > ticket.max_bytes)
        throw new UploadTooLarge(ticket.max_bytes);
      await uploadToBucket(ticket, file);
      return ticket.media_id;
    },
    onSuccess: (id) => {
      setMediaId(id);
    },
    onError: (error) => {
      setFileName(null);
      setFailure(
        error instanceof UploadTooLarge
          ? `That image is too large. The largest size this upload allows is ${error.maxBytes} bytes.`
          : "We could not upload that image. Please try again.",
      );
    },
  });

  const media = useQuery({
    queryKey: ["media", mediaId],
    queryFn: async () => {
      if (mediaId === null)
        throw new Error("The media poll ran with no media id.");
      return fetchMedia(mediaId);
    },
    enabled: mediaId !== null,
    refetchInterval: (query) =>
      isSettled(query.state.data?.status) ? false : POLL_INTERVAL_MS,
  });

  const status = media.data?.status;
  const processed = status === "processed";
  const rejected = status === "rejected";
  const thumbnail = media.data?.s3_key_thumbnail ?? null;
  const attached = mediaId !== null && draft.mediaIds.includes(mediaId);

  function handleFileChosen(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file === undefined) return;

    // A second choice replaces the first, draft included.
    if (mediaId !== null)
      mediator.send("media", { kind: "media-detached", mediaId });
    setFailure(null);
    setMediaId(null);
    setFileName(file.name);

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      // Refused here, so a type we already know is wrong never reaches the API.
      setFileName(null);
      setFailure(
        "That file is not an image we can post. Choose a JPEG, PNG or WebP.",
      );
      return;
    }

    upload.mutate(file);
  }

  function attach(): void {
    if (mediaId === null) return;
    mediator.send("media", { kind: "media-attached", mediaId });
  }

  function detach(): void {
    if (mediaId === null) return;
    mediator.send("media", { kind: "media-detached", mediaId });
  }

  return (
    <div className={styles.widget}>
      <Field id={FILE_FIELD_ID} label="Image">
        {/*
          Deliberately no `accept`: the browser's own filter drops a file the
          user chose without telling them why, and the type rule is one the user
          has to be able to read. The check below is the one that answers.
        */}
        <input
          {...describeField(FILE_FIELD_ID, { error: failure ?? undefined })}
          className={styles.file}
          type="file"
          name="image"
          onChange={handleFileChosen}
        />
      </Field>

      {/*
        The field's own message *is* the alert, rather than a second copy of it:
        `describeField` above points the input's `aria-describedby` at this id, so
        the message is both announced when focus reaches the control and
        announced immediately as a request failure. The id is on the alert
        itself, and the description is the message alone, because the alert's
        icon is `aria-hidden`.
      */}
      {failure === null ? null : (
        <InlineAlert id={`${FILE_FIELD_ID}-error`}>{failure}</InlineAlert>
      )}

      {fileName === null ? null : (
        <div className={styles.chosen}>
          {processed && thumbnail !== null ? (
            <img
              className={styles.preview}
              src={thumbnailUrl(thumbnail)}
              alt={`Preview of ${fileName}`}
            />
          ) : (
            <p className={styles.fileName}>
              <ImageIcon className={styles.icon} />
              {fileName}
            </p>
          )}

          {rejected ? (
            <InlineAlert>
              That image did not pass our checks, so it cannot be posted. Choose
              another one.
            </InlineAlert>
          ) : (
            <>
              <StatusLine>
                {processed
                  ? "This image is ready to attach."
                  : // Locally there is no GuardDuty, so this is where an upload
                    // against the real dev buckets stays. Correct behaviour, not
                    // a hang — see the wiki entry and MEDIA-002.
                    "Preparing this image. It can be attached once it has been checked."}
              </StatusLine>
              {attached ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={detach}
                >
                  Remove file
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!processed}
                  onClick={attach}
                >
                  Attach
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
