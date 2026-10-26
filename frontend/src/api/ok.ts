/** The common GET response boundary: successful data or an actionable error. */
export function ok<T>(
  { data, response }: { data?: T; response: Response },
  path: string,
): T {
  if (!response.ok || data === undefined)
    throw new Error(`GET ${path} answered ${response.status}`);
  return data;
}
