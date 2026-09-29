/**
 * The composer is wired into the route table, and `/compose` is still protected.
 *
 * `src/routes/routes.test.tsx` already pins that *something* with the heading
 * `Compose` renders at `/compose` for a `member` visitor and that an anonymous
 * visitor is sent to sign-in. What it cannot pin — because it predates this
 * unit — is that the thing rendering there is the real composer rather than the
 * placeholder from `views.tsx`. Without this file a unit could build a perfect
 * composer that no route points at, and every test would still be green.
 *
 * That other file is deliberately not edited: `FRONTEND-003` is changing it
 * concurrently, and the heading it pins (`/^compose$/i`) is a contract this
 * unit satisfies rather than renegotiates.
 *
 * **The reply/repost seam.** `ComposeMediator` has taken a `replyToPostId` and a
 * `repostOfPostId` since `FRONTEND-004`, but nothing outside the page could
 * reach them: `ComposePage` constructed the mediator with no options and read
 * nothing from the router, so "open the composer replying to post 42" had no
 * expression at all. `FRONTEND-005`'s feed is the caller that needs one, and
 * `frontend/src/features/compose/**` is in that unit's `forbidden_paths` — so
 * the address is the seam, and it is pinned here rather than left to the unit
 * that is not allowed to write it: `?reply_to=` and `?repost_of=`, each
 * carrying a post id.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { components } from "../../api/schema";
import { AuthProvider } from "../../auth/AuthContext";
import type { AuthService } from "../../auth/AuthService";
import { FakeAuthService, profileFound, testSession } from "../../test/auth";
import { createPost } from "../../test/compose";
import { server } from "../../test/server";
import { routes } from "../../routes/routes";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];

function renderAt(path: string, authService: AuthService) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider authService={authService}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("/compose", () => {
  it("renders the real composer for a signed-in member, under the pinned heading", async () => {
    server.use(profileFound());

    renderAt("/compose", new FakeAuthService({ session: testSession() }));

    expect(await screen.findByRole("heading", { name: /^compose$/i })).toBeInTheDocument();
    // The placeholder had no controls at all. These are the composer's.
    expect(screen.getByRole("textbox", { name: /post/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^post$/i })).toBeInTheDocument();
  });

  it("stays behind RequireAuth", async () => {
    renderAt("/compose", new FakeAuthService());

    expect(await screen.findByRole("heading", { name: /^sign\s*-?\s*in$/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /post/i })).toBeNull();
  });
});

/**
 * Asserted through `POST /posts` rather than through anything the page renders.
 *
 * Reply and repost context is not content — `PostBuilder.canBuild()` says so,
 * and the composer deliberately renders nothing for it — so the request body is
 * the only place the context is observable, and it is also the only place it
 * matters. A test that asserted on a "Replying to…" caption would pin a caption.
 */
async function postFrom(path: string): Promise<CreatePostRequest> {
  const bodies: CreatePostRequest[] = [];
  server.use(profileFound(), createPost({ onRequest: (body) => bodies.push(body) }));
  const user = userEvent.setup();

  renderAt(path, new FakeAuthService({ session: testSession() }));

  await user.type(await screen.findByRole("textbox", { name: /post/i }), "Called it");
  await user.click(screen.getByRole("button", { name: /^post$/i }));

  await waitFor(() => expect(bodies).toHaveLength(1));
  return bodies[0];
}

describe("the composer opens with the context the address carries", () => {
  it("sends a reply when opened from /compose?reply_to=42", async () => {
    expect(await postFrom("/compose?reply_to=42")).toMatchObject({
      is_reply: true,
      parent_post_id: 42,
      is_repost: false,
      original_post_id: null,
    });
  });

  it("sends a repost when opened from /compose?repost_of=7", async () => {
    expect(await postFrom("/compose?repost_of=7")).toMatchObject({
      is_reply: false,
      parent_post_id: null,
      is_repost: true,
      original_post_id: 7,
    });
  });

  it("sends a plain post when the address carries no context", async () => {
    expect(await postFrom("/compose")).toMatchObject({
      is_reply: false,
      parent_post_id: null,
      is_repost: false,
      original_post_id: null,
    });
  });

  it("ignores a context parameter that is not a post id", async () => {
    // The address bar is user input. A `parent_post_id: NaN` serializes to
    // `null` in JSON, so the backend would receive a top-level post claiming to
    // be a reply — an unusable value is therefore no context at all, not a
    // broken one, and certainly not a thrown render on a hand-typed address.
    expect(await postFrom("/compose?reply_to=not-a-number")).toMatchObject({
      is_reply: false,
      parent_post_id: null,
    });
  });
});
