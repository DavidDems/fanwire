import { config } from "../config";

/**
 * A public-media key joined to the configured base — the site origin in
 * production, not `/media`: keys already start with `media/`, and CloudFront
 * serves `/media/*` from the public-media bucket unchanged ([[0x04-media]]).
 *
 * The trims are what keep a trailing slash on the base, or a leading one on the
 * key, from producing a doubled separator that CloudFront answers 404 for.
 */
export function mediaUrl(key: string): string {
  return `${config.mediaBaseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}
