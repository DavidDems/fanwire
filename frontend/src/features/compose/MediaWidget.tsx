import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";

import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import { Field, describeField } from "../../components/FormField";
import { config } from "../../config";
import type { ComposeMediator } from "./ComposeMediator";

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
const ALLOWED_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

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
async function requestUploadTicket(mimeType: string): Promise<CreateUploadResponse> {
  const { data, response } = await apiClient.POST("/media/uploads", {
    body: { mime_type: mimeType },
  });
  if (!response.ok || data === undefined) {
    throw new Error(`POST /media/uploads answered ${response.status}`);
  }
  return data;
}

/**
 * The chosen file's bytes.
 *
 * `FileReader` rather than `file.arrayBuffer()`: `arrayBuffer`, `text` and
 * `stream` are all absent from jsdom 25's `Blob`, which implements `slice`,
 * `size` and `type` and nothing else. `FileReader` is the one reader present in
 * every browser this ships to *and* under test, so it is one code path rather
 * than a branch whose tested half is not the shipped half.
 */
function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error("That file could not be read."));
    };
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * The presigned POST body, encoded here rather than by handing `FormData` to
 * `fetch`.
 *
 * Two reasons, both about this request specifically. **Order is part of the
 * contract**: S3 ignores everything that follows the `file` part, so the
 * presigned fields go first, in the order the API returned them, and the file
 * goes last — encoding it here is what makes that visible and checkable instead
 * of a property of whichever multipart serializer the runtime happens to have.
 * And the runtimes differ: a `FormData` carrying a file cannot be serialized at
 * all under jsdom, because doing so reads the blob through `Blob.stream()`,
 * which jsdom does not implement.
 */
function encodeMultipart(
  fields: Record<string, string>,
  file: File,
  bytes: Uint8Array,
  boundary: string,
): ArrayBuffer {
  const encoder = new TextEncoder();
  // A quote in a filename would end the `filename="…"` parameter early. The name
  // is cosmetic to S3 — the object's key comes from the `key` field — so the
  // quotes are simply dropped rather than escaped into something S3 might keep.
  const filename = file.name.replace(/"/g, "");

  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${file.type}\r\n\r\n`,
    ),
  );
  parts.push(bytes);
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

  const buffer = new ArrayBuffer(parts.reduce((total, part) => total + part.byteLength, 0));
  const body = new Uint8Array(buffer);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return buffer;
}

/**
 * The multipart POST to the bucket.
 *
 * A plain `fetch`, and no `Authorization` header: the bucket has no use for our
 * ID token and sending it there would leak it. The boundary only has to be
 * unpredictable enough not to occur in the body, which is why it is not drawn
 * from `crypto`.
 */
async function uploadToBucket(ticket: CreateUploadResponse, file: File): Promise<void> {
  const boundary = `----fanwireUpload${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const body = encodeMultipart(ticket.fields, file, await readFileBytes(file), boundary);

  const response = await fetch(ticket.upload_url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
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
 * `URL.createObjectURL` is not used anywhere in this widget: jsdom does not
 * implement it, and the served image is the honest thing to show anyway — it is
 * what everyone else will see once the post is published, EXIF-stripped and
 * resized by the pipeline rather than the original off the user's disk.
 */
function thumbnailUrl(key: string): string {
  return `${config.mediaBaseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

export interface MediaWidgetProps {
  mediator: ComposeMediator;
}

export function MediaWidget({ mediator }: MediaWidgetProps) {
  const draft = useSyncExternalStore(mediator.subscribe, mediator.getDraft);
  const resetCount = useSyncExternalStore(mediator.subscribe, mediator.getResetCount);

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
      if (file.size > ticket.max_bytes) throw new UploadTooLarge(ticket.max_bytes);
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
      if (mediaId === null) throw new Error("The media poll ran with no media id.");
      return fetchMedia(mediaId);
    },
    enabled: mediaId !== null,
    refetchInterval: (query) => (isSettled(query.state.data?.status) ? false : POLL_INTERVAL_MS),
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
    if (mediaId !== null) mediator.send("media", { kind: "media-detached", mediaId });
    setFailure(null);
    setMediaId(null);
    setFileName(file.name);

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      // Refused here, so a type we already know is wrong never reaches the API.
      setFileName(null);
      setFailure("That file is not an image we can post. Choose a JPEG, PNG or WebP.");
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
    <div>
      <Field id={FILE_FIELD_ID} label="Image">
        {/*
          Deliberately no `accept`: the browser's own filter drops a file the
          user chose without telling them why, and the type rule is one the user
          has to be able to read. The check below is the one that answers.
        */}
        <input
          {...describeField(FILE_FIELD_ID, { error: failure ?? undefined })}
          type="file"
          name="image"
          onChange={handleFileChosen}
        />
      </Field>

      {/*
        The field's own message *is* the alert, rather than a second copy of it:
        `describeField` above points the input's `aria-describedby` at this id, so
        the message is both announced when focus reaches the control and
        announced immediately as a request failure.
      */}
      {failure === null ? null : (
        <p id={`${FILE_FIELD_ID}-error`} role="alert">
          {failure}
        </p>
      )}

      {fileName === null ? null : (
        <div>
          {processed && thumbnail !== null ? (
            <img src={thumbnailUrl(thumbnail)} alt={`Preview of ${fileName}`} />
          ) : (
            <p>{fileName}</p>
          )}

          {rejected ? (
            <p role="alert">
              That image did not pass our checks, so it cannot be posted. Choose another one.
            </p>
          ) : (
            <>
              <p role="status">
                {processed
                  ? "This image is ready to attach."
                  : // Locally there is no GuardDuty, so this is where an upload
                    // against the real dev buckets stays. Correct behaviour, not
                    // a hang — see the wiki entry and MEDIA-002.
                    "Preparing this image. It can be attached once it has been checked."}
              </p>
              {attached ? (
                <button type="button" onClick={detach}>
                  Remove file
                </button>
              ) : (
                <button type="button" disabled={!processed} onClick={attach}>
                  Attach
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
