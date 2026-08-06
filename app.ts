import { Elysia } from "elysia";
import mcp from "./mcp.js";
import { schemeImageKinds, type SchemeImageKind } from "./src/api.js";
import { RzdClient } from "./src/client.js";
import { configFromEnvironment } from "./src/config.js";
import { logEvent, redact } from "./src/log.js";
import { renderLanding } from "./src/landing.js";

/** Serves the carriage drawing with the free berths painted. It exists because the clients
 *  this server talks to pass only text through: an image block never reaches the model, so the
 *  picture has to be fetchable by URL. Deliberately narrow - a numeric scheme, a known layout
 *  and a handful of berths - so it cannot be turned into a general-purpose proxy. */
const maxPlaces = 36;

function places(value: string | undefined): number[] | null {
  if (!value) return [];
  const parsed = value.split(",").map((place) => Number(place.trim()));
  if (parsed.some((place) => !Number.isInteger(place) || place < 1 || place > 999)) return null;
  return parsed.length > maxPlaces ? null : parsed;
}

const app = new Elysia()
  .get("/", () => new Response(renderLanding(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } }))
  .get("/scheme/:schemeId/:kind", async ({ params, query, set }) => {
    const schemeId = Number(params.schemeId);
    const kind = params.kind.replace(/\.png$/, "") as SchemeImageKind;
    const free = places(query.free), selected = places(query.selected);
    if (!Number.isInteger(schemeId) || schemeId < 0 || !schemeImageKinds.includes(kind) || !free || !selected) {
      set.status = 400;
      return { error: "Expected /scheme/<number>/<layout>.png with at most 36 places in free or selected." };
    }
    const client = new RzdClient(configFromEnvironment());
    try {
      const image = await client.getSchemeImage(schemeId, kind, { free, selected });
      return new Response(Buffer.from(image.data, "base64"), {
        headers: { "content-type": image.mimeType, "cache-control": "public, max-age=86400, immutable" },
      });
    } catch (error) {
      // The detail goes to the log, never to the caller: a failed request carries the URL it
      // failed on, and that URL may be the private endpoint this server is configured with.
      logEvent({ scheme: schemeId, kind, error: redact(error instanceof Error ? error.message : String(error), client.config.baseUrl).slice(0, 200) });
      set.status = 502;
      return { error: "The carriage drawing could not be fetched." };
    } finally { client.close(); }
  })
  .all("/mcp", ({ request }) => mcp.fetch(request))
  .get("/health", () => ({ status: "ok", service: "rzd-api", version: "4.0.0" }));

export default app;
