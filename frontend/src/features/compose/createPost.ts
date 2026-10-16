import { apiClient } from "../../api/client";
import type { components } from "../../api/schema";

type CreatePostRequest = components["schemas"]["CreatePostRequest"];
type PostOut = components["schemas"]["PostOut"];

/**
 * `POST /posts`, for both composers: `/compose` (`ComposePage`) and the reply
 * box in the thread modal (`InlineComposer`). One request, so the two cannot
 * drift in how they send a post or decide it failed.
 */
export async function createPost(body: CreatePostRequest): Promise<PostOut> {
  const { data, response } = await apiClient.POST("/posts", { body });
  if (!response.ok || data === undefined) {
    throw new Error(`POST /posts answered ${response.status}`);
  }
  return data;
}
