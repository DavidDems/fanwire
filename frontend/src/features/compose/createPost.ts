import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];
type PostOut = components["schemas"]["PostOut"];

/**
 * A `POST /posts` that did not create a post, with what the server said.
 *
 * `detail` is the error body's `detail` as it arrived — a machine code string
 * for a refused `data_link` (`POSTS-005`), a list for Pydantic's own 422,
 * anything at all otherwise — and is left `unknown` on purpose: deciding what
 * it means is the caller's job (`refusalMessage`), and a type that claimed
 * more would be a promise this file cannot keep.
 */
export class PostNotCreated extends Error {
  readonly status: number;

  readonly detail: unknown;

  constructor(status: number, detail: unknown) {
    super(`POST /posts answered ${status}`);
    this.name = "PostNotCreated";
    this.status = status;
    this.detail = detail;
  }
}

function detailOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "detail" in error
    ? (error as { detail: unknown }).detail
    : undefined;
}

/**
 * `POST /posts`, for both composers: `/compose` (`ComposePage`) and the reply
 * box in the thread modal (`InlineComposer`). One request, so the two cannot
 * drift in how they send a post or decide it failed.
 */
export async function createPost(body: CreatePostRequest): Promise<PostOut> {
  const { data, error, response } = await apiClient.POST("/posts", { body });
  if (!response.ok || data === undefined) {
    throw new PostNotCreated(response.status, detailOf(error));
  }
  return data;
}
