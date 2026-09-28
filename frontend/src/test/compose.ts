import { HttpResponse, http, type RequestHandler } from "msw";

import type { components } from "../api/schema";
import { server } from "./server";

/**
 * The compose unit's network kit: fixtures and msw handler factories for the
 * five endpoints the composer touches, plus a request recorder.
 *
 * Everything here is typed against the generated schema, so a fixture that
 * drifts from `backend/openapi.json` is a typecheck failure rather than a suite
 * that passes against a body the backend never sends. The one exception is the
 * S3 upload target: a presigned POST goes to a bucket, not to the API, so it is
 * not in the OpenAPI document and gets a stable fake absolute URL here instead.
 *
 * `src/test/auth.tsx` already owns `GET /users/me` and `GET /events/teams`
 * (`teamsAre`, `testTeams`) — they are not duplicated here.
 */

type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
type CreateUploadResponse = components["schemas"]["CreateUploadResponse"];
type MediaOut = components["schemas"]["MediaOut"];
type MediaStatus = components["schemas"]["MediaStatus"];
type CreatePostRequest = components["schemas"]["CreatePostRequest"];
type PostOut = components["schemas"]["PostOut"];
type GameOut = components["schemas"]["GameOut"];

/**
 * Where a presigned POST goes. Deliberately *not* same-origin and not under
 * `/api`: the whole point of the presigned POST is that the file bytes never
 * pass through the API, and a test can only see that if the two are distinct
 * origins. `.invalid` is reserved, so a handler that fails to match cannot
 * reach anything real.
 */
export const TEST_UPLOAD_URL = "https://fanwire-quarantine.s3.test.invalid/";

/** The media id every fixture in this file agrees on. */
export const TEST_MEDIA_ID = 4242;

/** `s3_key_thumbnail` once processing has run — what the widget renders from. */
export const TEST_THUMBNAIL_KEY = "media/4242/thumb.jpg";

/** A small in-memory file. Keep sizes tiny and shrink `max_bytes` instead. */
export function testFile(options: { name?: string; type?: string; bytes?: number } = {}): File {
  const { name = "photo.jpg", type = "image/jpeg", bytes = 16 } = options;
  return new File([new Uint8Array(bytes)], name, { type });
}

/** The `POST /media/uploads` 201 body: the presigned POST, its fields and the cap. */
export function testUpload(overrides: Partial<CreateUploadResponse> = {}): CreateUploadResponse {
  return {
    media_id: TEST_MEDIA_ID,
    upload_url: TEST_UPLOAD_URL,
    s3_key: "uploads/4242-photo.jpg",
    // Small on purpose: an oversize case allocates 128 bytes, not 5MB.
    max_bytes: 64,
    fields: {
      key: "uploads/4242-photo.jpg",
      "Content-Type": "image/jpeg",
      policy: "eyJ0ZXN0IjogInBvbGljeSJ9",
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
      "x-amz-signature": "test-signature-not-a-real-one",
    },
    ...overrides,
  };
}

export interface UploadTicketOptions {
  /** The 201 body. */
  response?: CreateUploadResponse;
  /** Anything but 201 answers a FastAPI-shaped error instead. */
  status?: number;
  onRequest?: (body: CreateUploadRequest, request: Request) => void;
}

/** `POST /media/uploads` — the presigned ticket. */
export function uploadTicket(options: UploadTicketOptions = {}): RequestHandler {
  const { response = testUpload(), status = 201, onRequest } = options;

  return http.post("*/media/uploads", async ({ request }) => {
    const body = (await request.clone().json()) as CreateUploadRequest;
    onRequest?.(body, request);
    if (status !== 201) {
      return HttpResponse.json({ detail: "upload could not be started" }, { status });
    }
    return HttpResponse.json<CreateUploadResponse>(response, { status: 201 });
  });
}

/** Everything a test needs to know about the multipart POST that reached S3. */
export interface RecordedUpload {
  url: string;
  /** Must be `null` — sending the Cognito ID token to a bucket would leak it. */
  authorization: string | null;
  /** Form field names in order; S3 requires `file` last. */
  fieldNames: string[];
  /** The string entries, i.e. the presigned `fields`. */
  fields: Record<string, string>;
  /** The binary entry, or `null` if the request carried no file. */
  file: File | null;
}

export interface S3UploadOptions {
  /** S3 answers a presigned POST with 204 and no body. */
  status?: number;
  onRequest?: (upload: RecordedUpload) => void;
}

/** The bucket itself: the presigned POST target, not an API route. */
export function s3Upload(options: S3UploadOptions = {}): RequestHandler {
  const { status = 204, onRequest } = options;

  return http.post(TEST_UPLOAD_URL, async ({ request }) => {
    if (onRequest) {
      const form = await request.clone().formData();
      const fieldNames: string[] = [];
      const fields: Record<string, string> = {};
      let file: File | null = null;

      for (const [name, value] of form.entries()) {
        fieldNames.push(name);
        if (typeof value === "string") fields[name] = value;
        else file = value;
      }

      onRequest({
        url: request.url,
        authorization: request.headers.get("Authorization"),
        fieldNames,
        fields,
        file,
      });
    }

    return new HttpResponse(null, { status });
  });
}

/** A `MediaOut` row. Defaults to the freshly-uploaded, not-yet-scanned state. */
export function testMedia(overrides: Partial<MediaOut> = {}): MediaOut {
  return {
    id: TEST_MEDIA_ID,
    status: "uploaded",
    mime_type: "image/jpeg",
    size_bytes: 16,
    s3_key_public: null,
    s3_key_thumbnail: null,
    created_at: "2026-09-28T00:00:00Z",
    ...overrides,
  };
}

/** The same row once the pipeline finished: the only state that may be attached. */
export function processedMedia(overrides: Partial<MediaOut> = {}): MediaOut {
  return testMedia({
    status: "processed",
    s3_key_public: "media/4242/full.jpg",
    s3_key_thumbnail: TEST_THUMBNAIL_KEY,
    ...overrides,
  });
}

export interface MediaStatusOptions {
  /**
   * The status each successive `GET /media/{id}` answers. The last entry
   * repeats forever, so `["processed"]` is a constant and
   * `["uploaded", "scanning", "processed"]` is a pipeline that finishes on the
   * third poll.
   */
  statuses: MediaStatus[];
  /** Extra `MediaOut` fields for every answer. */
  media?: Partial<MediaOut>;
  onRequest?: (mediaId: number, callNumber: number) => void;
}

/** `GET /media/{media_id}` — the poll the widget waits on. */
export function mediaStatuses(options: MediaStatusOptions): RequestHandler {
  const { statuses, media = {}, onRequest } = options;
  let calls = 0;

  return http.get<{ media_id: string }>("*/media/:media_id", ({ params }) => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls += 1;

    const id = Number(params.media_id);
    onRequest?.(id, calls);

    const body =
      status === "processed"
        ? processedMedia({ id, ...media })
        : testMedia({ id, status, ...media });

    return HttpResponse.json<MediaOut>(body);
  });
}

/** The `POST /posts` 201 body. */
export function testPost(overrides: Partial<PostOut> = {}): PostOut {
  return {
    id: 900,
    author_id: 7,
    text: "Raptors in 6",
    is_reply: false,
    is_repost: false,
    parent_post_id: null,
    original_post_id: null,
    reported: false,
    created_at: "2026-09-28T00:00:00Z",
    ...overrides,
  };
}

export interface CreatePostOptions {
  /** Anything but 201 is the failure the draft has to survive. */
  status?: number;
  post?: PostOut;
  onRequest?: (body: CreatePostRequest) => void;
}

/** `POST /posts` — what a built draft is submitted to. */
export function createPost(options: CreatePostOptions = {}): RequestHandler {
  const { status = 201, post = testPost(), onRequest } = options;

  return http.post("*/posts", async ({ request }) => {
    const body = (await request.clone().json()) as CreatePostRequest;
    onRequest?.(body);
    if (status !== 201) {
      return HttpResponse.json({ detail: "the post could not be saved" }, { status });
    }
    return HttpResponse.json<PostOut>(post, { status: 201 });
  });
}

/**
 * Two games with ids that do not share a prefix, so a test can tell filtering
 * from "returned everything" — and whose scores, seasons and dates contain
 * neither id as a substring.
 */
export function testGames(): GameOut[] {
  return [
    {
      id: 123,
      api_sports_game_id: 5001,
      home_team_id: 1,
      away_team_id: 2,
      home_score: 110,
      away_score: 98,
      date: "2026-09-20T23:00:00Z",
      season: "2025-2026",
      venue: "Scotiabank Arena",
      player_stats: [],
    },
    {
      id: 789,
      api_sports_game_id: 5002,
      home_team_id: 2,
      away_team_id: 1,
      home_score: 101,
      away_score: 104,
      date: "2026-09-22T23:00:00Z",
      season: "2025-2026",
      venue: "Footprint Center",
      player_stats: [],
    },
  ];
}

export interface GamesOptions {
  games?: GameOut[];
  onRequest?: () => void;
}

/** `GET /events/games` — what a `#` offers. `$` is `teamsAre` in `./auth`. */
export function gamesAre(options: GamesOptions = {}): RequestHandler {
  const { games = testGames(), onRequest } = options;

  return http.get("*/events/games", () => {
    onRequest?.();
    return HttpResponse.json<GameOut[]>(games);
  });
}

export interface RecordedRequest {
  method: string;
  url: string;
  pathname: string;
}

export interface RequestRecorder {
  /** Every request msw saw since recording started, in order. */
  calls: RecordedRequest[];
  /** Just the pathnames — what "no request on mount" is asserted against. */
  paths(): string[];
  /** Always call this in the test's own cleanup. */
  stop(): void;
}

/**
 * Record every request the app makes.
 *
 * `onUnhandledRequest: "error"` is not enough on its own to pin "this component
 * asks for nothing": msw rejects the request, react-query swallows it into an
 * error state with `retry: false`, and the assertion about the quiet component
 * still passes. Counting from the life-cycle events is the deterministic form.
 */
export function recordRequests(): RequestRecorder {
  const calls: RecordedRequest[] = [];

  const listener = ({ request }: { request: Request; requestId: string }) => {
    calls.push({
      method: request.method,
      url: request.url,
      pathname: new URL(request.url).pathname,
    });
  };

  server.events.on("request:start", listener);

  return {
    calls,
    paths: () => calls.map((call) => call.pathname),
    stop: () => {
      server.events.removeListener("request:start", listener);
    },
  };
}
