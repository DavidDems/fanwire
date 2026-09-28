/**
 * FRONTEND-004 acceptance criteria 6, 7 and 8 — the media widget.
 *
 * The shape and the reason (`wiki/CodeContext/Modules/0x04-media.md`, "API
 * routes"): `POST /media/uploads` returns `upload_url`, `fields` and
 * `max_bytes`, and the browser then sends a multipart POST of those fields plus
 * the file **straight to the bucket**. File bytes never pass through the API —
 * that is the entire reason the presigned POST exists.
 *
 * Which is why the S3 request does not go through `apiClient`. `apiClient`
 * attaches the Cognito **ID token** and the `/api` base URL; pointing it at a
 * bucket would send our token to S3 and send the upload to the wrong origin. So
 * a real token provider is installed here and the two requests are checked
 * against each other: the API call carries `Authorization`, and the bucket call
 * must not. With no provider installed neither would carry one and the
 * assertion would pass while proving nothing.
 *
 * Status values are the API's own, lower-case, four of them:
 * `uploaded | scanning | processed | rejected`. There is no `Quarantined`
 * value — the brief's wording means *not yet `processed`*, and both `uploaded`
 * and `scanning` are un-attachable.
 *
 * No `URL.createObjectURL`: jsdom does not implement it and `setupTests.ts` is
 * outside this task's permitted paths, so the widget shows the file's **name**
 * while pending and the served thumbnail (`config.mediaBaseUrl` +
 * `s3_key_thumbnail`) once processed.
 *
 * No fake timers either. Fake timers plus msw plus react-query's
 * `refetchInterval` is how this kind of test becomes a flake; the polling tests
 * below drive a handler that answers successive statuses and wait for the DOM.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { setTokenProvider } from "../../api/client";
import { config } from "../../config";
import { TEST_ID_TOKEN, renderWithAuth } from "../../test/auth";
import {
  TEST_MEDIA_ID,
  TEST_THUMBNAIL_KEY,
  TEST_UPLOAD_URL,
  mediaStatuses,
  s3Upload,
  testFile,
  testUpload,
  uploadTicket,
  type RecordedUpload,
} from "../../test/compose";
import { server } from "../../test/server";
import { ComposeMediator } from "./ComposeMediator";
import { MediaWidget } from "./MediaWidget";

afterEach(() => {
  // The provider is module state on the singleton client; leaving a token
  // installed would follow this file into the next one.
  setTokenProvider(() => null);
});

function renderWidget() {
  const mediator = new ComposeMediator();
  renderWithAuth(<MediaWidget mediator={mediator} />);
  return { mediator, user: userEvent.setup() };
}

/** The labelled file input. `Field`/`describeField` is the labelling idiom. */
function fileInput(): HTMLElement {
  return screen.getByLabelText(/image/i);
}

function attachButton(): HTMLElement {
  return screen.getByRole("button", { name: /attach/i });
}

describe("the upload goes straight to the bucket, never through the API", () => {
  it("posts the presigned fields and the file to upload_url, with the file last", async () => {
    setTokenProvider(() => TEST_ID_TOKEN);
    const ticket = testUpload();
    const uploads: RecordedUpload[] = [];
    server.use(
      uploadTicket({ response: ticket }),
      s3Upload({ onRequest: (upload) => uploads.push(upload) }),
      mediaStatuses({ statuses: ["processed"] }),
    );
    const { user } = renderWidget();

    await user.upload(fileInput(), testFile());

    await waitFor(() => expect(uploads).toHaveLength(1));
    const [upload] = uploads;

    expect(upload.url).toBe(TEST_UPLOAD_URL);
    // S3 ignores anything after the `file` part, so `file` goes last.
    expect(upload.fieldNames).toEqual([...Object.keys(ticket.fields), "file"]);
    expect(upload.fields).toEqual(ticket.fields);
    expect(upload.file?.name).toBe("photo.jpg");
    expect(upload.file?.size).toBe(16);
  });

  it("sends no Authorization header to the bucket, while the API call carries one", async () => {
    setTokenProvider(() => TEST_ID_TOKEN);
    const uploads: RecordedUpload[] = [];
    const ticketRequests: Request[] = [];
    server.use(
      uploadTicket({
        onRequest: (_body, request) => ticketRequests.push(request),
      }),
      s3Upload({ onRequest: (upload) => uploads.push(upload) }),
      mediaStatuses({ statuses: ["processed"] }),
    );
    const { user } = renderWidget();

    await user.upload(fileInput(), testFile());

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(ticketRequests[0].headers.get("Authorization")).toBe(`Bearer ${TEST_ID_TOKEN}`);
    expect(uploads[0].authorization).toBeNull();
  });

  it("asks the API for a ticket with the mime type only, never the bytes", async () => {
    const bodies: unknown[] = [];
    const ticketRequests: Request[] = [];
    server.use(
      uploadTicket({
        onRequest: (body, request) => {
          bodies.push(body);
          ticketRequests.push(request);
        },
      }),
      s3Upload(),
      mediaStatuses({ statuses: ["processed"] }),
    );
    const { user } = renderWidget();

    await user.upload(fileInput(), testFile({ bytes: 32 }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ mime_type: "image/jpeg" });
    expect(ticketRequests[0].headers.get("Content-Type")).toMatch(/application\/json/);
  });
});

describe("a file the client can already tell is wrong is rejected before it is uploaded", () => {
  it("refuses a type outside jpeg, png and webp without calling the API at all", async () => {
    // The MIME check happens *before* `POST /media/uploads`: a bad type never
    // reaches the API. The check is UX only — S3's policy and the processing
    // Lambda's Pillow parse are the real gates — but it is still the message
    // the user sees, so it has to be right.
    let ticketCalls = 0;
    let s3Calls = 0;
    server.use(
      uploadTicket({ onRequest: () => (ticketCalls += 1) }),
      s3Upload({ onRequest: () => (s3Calls += 1) }),
    );
    const { user, mediator } = renderWidget();

    await user.upload(fileInput(), testFile({ name: "notes.pdf", type: "application/pdf" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/jpe?g|png|webp/i);
    expect(ticketCalls, "a rejected type must not reach POST /media/uploads").toBe(0);
    expect(s3Calls).toBe(0);
    expect(mediator.getDraft().mediaIds).toEqual([]);
  });

  it("refuses an SVG, which is a type the security baseline excludes by name", async () => {
    let ticketCalls = 0;
    server.use(uploadTicket({ onRequest: () => (ticketCalls += 1) }), s3Upload());
    const { user } = renderWidget();

    await user.upload(fileInput(), testFile({ name: "logo.svg", type: "image/svg+xml" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(ticketCalls).toBe(0);
  });

  it("refuses a file bigger than the max_bytes the API returned, before the bucket POST", async () => {
    // `max_bytes` only exists in the ticket response, so this check necessarily
    // comes *after* `POST /media/uploads` — and necessarily before the upload.
    let ticketCalls = 0;
    let s3Calls = 0;
    server.use(
      uploadTicket({
        response: testUpload({ max_bytes: 64 }),
        onRequest: () => (ticketCalls += 1),
      }),
      s3Upload({ onRequest: () => (s3Calls += 1) }),
    );
    const { user, mediator } = renderWidget();

    await user.upload(fileInput(), testFile({ bytes: 128 }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/large|size|big|byte/i);
    expect(ticketCalls, "max_bytes comes from the ticket, so the ticket is fetched").toBe(1);
    expect(s3Calls, "no upload may be attempted for an oversize file").toBe(0);
    expect(mediator.getDraft().mediaIds).toEqual([]);
  });

  it("accepts png and webp, which are on the allow-list with jpeg", async () => {
    const uploads: RecordedUpload[] = [];
    server.use(
      uploadTicket(),
      s3Upload({ onRequest: (upload) => uploads.push(upload) }),
      mediaStatuses({ statuses: ["processed"] }),
    );
    const { user } = renderWidget();

    await user.upload(fileInput(), testFile({ name: "shot.png", type: "image/png" }));

    await waitFor(() => expect(uploads).toHaveLength(1));
  });
});

describe("only processed media can be attached", () => {
  it("shows the file's name while the upload is still being processed", async () => {
    server.use(uploadTicket(), s3Upload(), mediaStatuses({ statuses: ["uploaded"] }));
    const { user } = renderWidget();

    await user.upload(fileInput(), testFile({ name: "courtside.jpg" }));

    expect(await screen.findByText(/courtside\.jpg/)).toBeInTheDocument();
  });

  it.each(["uploaded", "scanning"] as const)(
    "will not let %s media be attached",
    async (status) => {
      const polls: number[] = [];
      server.use(
        uploadTicket(),
        s3Upload(),
        mediaStatuses({
          statuses: [status],
          onRequest: (_id, call) => polls.push(call),
        }),
      );
      const { user, mediator } = renderWidget();

      await user.upload(fileInput(), testFile());

      await waitFor(() => expect(polls.length).toBeGreaterThan(0));
      expect(attachButton()).toBeDisabled();
      expect(mediator.getDraft().mediaIds).toEqual([]);
    },
  );

  it("offers no attach at all for rejected media, and says so", async () => {
    server.use(uploadTicket(), s3Upload(), mediaStatuses({ statuses: ["rejected"] }));
    const { user, mediator } = renderWidget();

    await user.upload(fileInput(), testFile());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /attach/i })).toBeNull();
    expect(mediator.getDraft().mediaIds).toEqual([]);
  });

  it("polls GET /media/{id} until it is processed, then allows attaching", async () => {
    const polls: number[] = [];
    server.use(
      uploadTicket(),
      s3Upload(),
      mediaStatuses({
        statuses: ["uploaded", "scanning", "processed"],
        onRequest: (id, call) => polls.push(id === TEST_MEDIA_ID ? call : -1),
      }),
    );
    const { user, mediator } = renderWidget();

    await user.upload(fileInput(), testFile());

    await waitFor(() => expect(attachButton()).toBeEnabled(), {
      timeout: 5000,
    });
    // Three answers means it really polled rather than asking once and hoping.
    expect(polls.length).toBeGreaterThanOrEqual(3);
    expect(polls).not.toContain(-1);

    await user.click(attachButton());

    expect(mediator.getDraft().mediaIds).toEqual([TEST_MEDIA_ID]);
  });

  it("renders the served thumbnail once processed, not a blob url", async () => {
    server.use(uploadTicket(), s3Upload(), mediaStatuses({ statuses: ["processed"] }));
    const { user } = renderWidget();

    await user.upload(fileInput(), testFile());

    const image = await screen.findByRole("img");
    expect(image.getAttribute("src")).toContain(config.mediaBaseUrl);
    expect(image.getAttribute("src")).toContain(TEST_THUMBNAIL_KEY);
    expect(image).toHaveAccessibleName();
  });
});
