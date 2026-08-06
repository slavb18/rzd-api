/** One line of JSON per event, straight to stdout, because that is what a serverless platform
 *  collects and shows. Without it a failing deployment says nothing at all: a stuck upstream
 *  and a client that never called the tool look exactly alike from outside. */
export function logEvent(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));
}

/** Names an upstream call by the path below the configured endpoint. The endpoint itself is
 *  never written: it may be a private proxy whose address must not appear anywhere, and a log
 *  line is a place secrets leak into by accident. */
export function endpointLabel(url: string, baseUrl: string): string {
  const withoutQuery = url.split("?")[0]!;
  const base = baseUrl.replace(/\/$/, "");
  if (withoutQuery.startsWith(base)) return withoutQuery.slice(base.length).replace(/^\//, "");
  try { return new URL(withoutQuery).pathname.replace(/^\//, ""); } catch { return "unknown"; }
}
