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

/** A link to the drawing on this server. Clients that only pass text through - and the ones
 *  this server actually talks to do exactly that - cannot use an image block, so the picture
 *  has to be reachable by URL. It points here rather than at ticket.rzd.ru because only this
 *  server paints the free berths; the upstream drawing is an unpainted template. */
export function schemeImageUrl(baseUrl: string, schemeId: number, kind: string, free: number[]): string {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/scheme/${schemeId}/${kind}.png`);
  if (free.length) url.searchParams.set("free", free.join(","));
  return url.toString();
}
