/** Vite remembers failed CSS preloads; replace those links before reimporting. */
export async function retryStyles(): Promise<void> {
  await Promise.all(
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
      .filter((link) => {
        if (new URL(link.href).origin !== location.origin) return false;
        try {
          return !link.sheet?.cssRules;
        } catch {
          return true;
        }
      })
      .map(
        (link) =>
          new Promise<void>((resolve, reject) => {
            const next = link.cloneNode() as HTMLLinkElement;
            next.onload = () => resolve();
            next.onerror = reject;
            link.replaceWith(next);
          }),
      ),
  );
}
