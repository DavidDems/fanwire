import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from "react";

import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";
import { buttonClass } from "../../components/ui/Button";
import { CircleXIcon, PaperclipIcon } from "../../components/ui/icons";
import { InlineAlert } from "../../components/ui/InlineAlert";
import messageStyles from "../../components/ui/message.module.css";
import { StatusLine } from "../../components/ui/StatusLine";
import { config } from "../../config";
import type { ComposeMediator } from "./ComposeMediator";
import styles from "./MediaWidget.module.css";

/**
 * The media widget: choose a file, get it to the bucket, wait for the pipeline,
 * and the image is attached by itself (`FRONTEND-020`).
 *
 * **The file bytes never pass through the API.** `POST /media/uploads` returns a
 * presigned POST — `upload_url`, `fields` and `max_bytes` — and the browser then
 * submits a multipart form straight to the bucket ([[0x04-media]] "API routes").
 * That request is a plain `fetch`, deliberately *not* `apiClient`: `apiClient`
 * attaches the Cognito ID token and the `/api` base URL, so using it here would
 * send our token to S3 and send the upload to the wrong origin.
 *
 * **The paperclip opens a hidden file input**, which keeps no `accept` (the
 * browser's own filter drops a file without saying why; the check below is the
 * one that answers) and is no tab stop and no name of its own: the paperclip is
 * the one control named for an image. `tools` sit beside it in the same row
 * (the composer's Attach stats).
 *
 * **The check waits in place.** From the choice, a tile of fixed size shows the
 * file's name under a static overlay, "Checking the image…", through the upload
 * and the pipeline alike; on `processed` the served thumbnail takes the tile's
 * place and the id goes into the draft with no second press. Meanwhile the
 * mediator hears `media-checking`, so the composer's submit waits.
 *
 * **The clock is the client's, from the end of the bucket upload** (the human,
 * 2026-10-24: a slow connection never fails a good image): one poll a second,
 * the first at once, and at 30 s one last poll, then a refusal if that is not
 * `processed` either. A timer of its own, not react-query's interval, which
 * pauses in a hidden tab: the poll at the bound must still be made (R17). It
 * stops at a terminal status, at the bound, on a new choice and on unmount.
 *
 * **Every refusal is one red line**: a type refused here, a file over the
 * ticket's `max_bytes`, `rejected`, or the bound. The media row is left as it
 * is: an unattached row is the normal case ([[0x04-media]]). A failure to reach
 * the API or the bucket keeps its own words.
 *
 * It reports to the mediator and reads the mediator's draft. It imports neither
 * of the other two compose controls.
 */

type CreateUploadResponse = components["schemas"]["CreateUploadResponse"];
type MediaOut = components["schemas"]["MediaOut"];

/**
 * [[0x04-media]] "Security requirements": jpeg, png and webp only, SVG excluded
 * by name because it can carry script. For the message only: S3's policy and
 * the processing Lambda's Pillow parse are the real gates.
 */
const ALLOWED_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/** One poll a second: at most 31 in the 30 s, each a primary-key read. */
const POLL_INTERVAL_MS = 1_000;

/** How long after the upload ends the pipeline has to answer `processed`. */
const CHECK_BOUND_MS = 30_000;

const REFUSED = "The image you attached is too large or cannot be accepted";
const UPLOAD_FAILED = "We could not upload that image. Please try again.";

/** A refusal, as opposed to a failure to reach the API or the bucket. */
class Refused extends Error {}

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
 * The multipart POST to the bucket: a plain `fetch` with **no `Authorization`
 * header** (our ID token must not leak to S3) and no `Content-Type` (`fetch`
 * writes the boundary). **The presigned fields go first, in the order the API
 * returned them, and the file last**, because S3 ignores everything after the
 * `file` part; `MediaWidget.test.tsx` asserts the order that reaches the bucket.
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

/**
 * The served thumbnail's URL. `URL.createObjectURL` is not used, by product
 * decision: the first image anyone sees is the served one, EXIF-stripped and
 * resized by the pipeline, never the original off the user's disk.
 */
function thumbnailUrl(key: string): string {
  return `${config.mediaBaseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/**
 * The chosen image. `mediaId` is `null` while the upload is in flight;
 * `thumbnail` is `undefined` until the pipeline answers `processed` (and `null`
 * if it answered with no thumbnail key).
 */
interface Chosen {
  name: string;
  mediaId: number | null;
  thumbnail?: string | null;
}

export interface MediaWidgetProps {
  mediator: ComposeMediator;
  /** Further controls for the attach row, after the paperclip. */
  tools?: ReactNode;
}

export function MediaWidget({ mediator, tools }: MediaWidgetProps) {
  const resetCount = useSyncExternalStore(
    mediator.subscribe,
    mediator.getResetCount,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Bumped by every choice, removal, reset and unmount: an upload that answers
  // for an older one is dropped, so it never lands in the next one's place.
  const generation = useRef(0);

  useEffect(() => {
    // Clearing the composer clears the image with it. The draft alone cannot
    // say this happened (an emptied draft and a never-filled one are the same
    // value), so the reset counter is what the widget watches.
    generation.current += 1;
    setChosen(null);
    setFailure(null);
  }, [resetCount]);

  useEffect(() => {
    const current = generation;
    return () => {
      current.current += 1;
    };
  }, []);

  const checking = chosen !== null && chosen.thumbnail === undefined;
  useEffect(() => {
    if (!checking) return;
    mediator.send("media", { kind: "media-checking", checking: true });
    return () => {
      mediator.send("media", { kind: "media-checking", checking: false });
    };
  }, [mediator, checking]);

  // The poll, from the moment the upload has ended (its id is set then).
  const pollId = checking ? chosen.mediaId : null;
  useEffect(() => {
    if (pollId === null) return;
    const start = Date.now();
    let stopped = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll(id: number): Promise<void> {
      polls += 1;
      const last = Date.now() - start >= CHECK_BOUND_MS;
      const media = await fetchMedia(id).catch(() => null);
      if (stopped) return;
      if (media?.status === "processed") {
        mediator.send("media", { kind: "media-attached", mediaId: id });
        setChosen(
          (current) =>
            current && {
              ...current,
              thumbnail: media.s3_key_thumbnail ?? null,
            },
        );
      } else if (media?.status === "rejected" || last) {
        setChosen(null);
        setFailure(REFUSED);
      } else {
        // On each second from the upload's end; the last exactly at the bound.
        const next = start + Math.min(polls * POLL_INTERVAL_MS, CHECK_BOUND_MS);
        timer = setTimeout(() => void poll(id), next - Date.now());
      }
    }

    void poll(pollId);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [mediator, pollId]);

  async function upload(file: File, mine: number): Promise<void> {
    try {
      const ticket = await requestUploadTicket(file.type);
      // `max_bytes` only exists in the ticket, so this check comes after it,
      // and before a single byte goes to the bucket.
      if (file.size > ticket.max_bytes) throw new Refused();
      await uploadToBucket(ticket, file);
      if (generation.current === mine)
        setChosen({ name: file.name, mediaId: ticket.media_id });
    } catch (error) {
      if (generation.current !== mine) return;
      setChosen(null);
      setFailure(error instanceof Refused ? REFUSED : UPLOAD_FAILED);
    }
  }

  /** Take the current image out: the draft's id, the tile and its upload. */
  function drop(): void {
    generation.current += 1;
    const id = chosen?.mediaId;
    if (typeof id === "number")
      mediator.send("media", { kind: "media-detached", mediaId: id });
    setChosen(null);
    setFailure(null);
  }

  function handleFileChosen(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // Emptied, so choosing the same file again (after a refusal) is a change.
    event.target.value = "";
    if (file === undefined) return;
    // A second choice replaces the first, draft included.
    drop();
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      // Refused here, so a type we already know is wrong never reaches the API.
      setFailure(REFUSED);
      return;
    }
    setChosen({ name: file.name, mediaId: null });
    void upload(file, generation.current);
  }

  return (
    <div className={styles.widget}>
      <div className={styles.row}>
        <button
          type="button"
          className={`${buttonClass("ghost", "md")} ${styles.tool}`}
          aria-label="Attach an image"
          onClick={() => inputRef.current?.click()}
        >
          <PaperclipIcon />
        </button>
        {tools}
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        name="image"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleFileChosen}
      />

      {failure === REFUSED ? (
        <p
          role="alert"
          className={`${messageStyles.message} ${messageStyles.danger}`}
        >
          <CircleXIcon className={messageStyles.icon} />
          <span>{REFUSED}</span>
        </p>
      ) : failure === null ? null : (
        <InlineAlert>{failure}</InlineAlert>
      )}

      {chosen === null ? null : checking ? (
        <div className={styles.tile}>
          <span className={styles.name}>{chosen.name}</span>
          <div className={styles.overlay}>
            <StatusLine>Checking the image…</StatusLine>
          </div>
        </div>
      ) : (
        <div className={styles.row}>
          {chosen.thumbnail ? (
            <img
              className={styles.tile}
              src={thumbnailUrl(chosen.thumbnail)}
              alt={`Preview of ${chosen.name}`}
            />
          ) : (
            <span className={`${styles.tile} ${styles.name}`}>
              {chosen.name}
            </span>
          )}
          <button
            type="button"
            className={`${buttonClass("ghost", "md")} ${styles.tool}`}
            aria-label="Remove image"
            onClick={drop}
          >
            <CircleXIcon />
          </button>
        </div>
      )}
    </div>
  );
}
