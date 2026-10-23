import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Which posts this viewer reported in this session (`FRONTEND-012`): the
 * menu's "Reported", disabled, on every card of such a post.
 *
 * **This session's memory only**, decided by the human (2026-10-22):
 * `PostView` has no "already reported" field and the endpoint is idempotent,
 * so a reload offering Report again is harmless. **Kept per app**, against the
 * app's one `QueryClient`, not in a module-level set, so a fresh app (a
 * reload, or a test's fresh render) remembers nothing. Not a query entry:
 * nothing fetches it, and invalidating the cache (recovering an account) must
 * not forget it.
 *
 * Every card of a post subscribes to the same store, so the thread modal's
 * root card reads "Reported" the moment the feed's card under it was reported.
 */
interface ReportedStore {
  has: (postId: number) => boolean;
  add: (postId: number) => void;
  subscribe: (listener: () => void) => () => void;
}

const stores = new WeakMap<QueryClient, ReportedStore>();

function storeFor(queryClient: QueryClient): ReportedStore {
  const existing = stores.get(queryClient);
  if (existing !== undefined) return existing;

  const reported = new Set<number>();
  const listeners = new Set<() => void>();
  const store: ReportedStore = {
    has: (postId) => reported.has(postId),
    add: (postId) => {
      if (reported.has(postId)) return;
      reported.add(postId);
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  stores.set(queryClient, store);
  return store;
}

/** Whether `postId` was reported in this session, and how to record that it was. */
export function useReported(postId: number): {
  reported: boolean;
  markReported: () => void;
} {
  const store = storeFor(useQueryClient());
  const reported = useSyncExternalStore(store.subscribe, () =>
    store.has(postId),
  );
  const markReported = useCallback(() => {
    store.add(postId);
  }, [store, postId]);
  return { reported, markReported };
}
