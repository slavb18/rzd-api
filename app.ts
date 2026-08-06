import { Elysia } from "elysia";
import mcp from "./mcp.js";
import { renderLanding } from "./src/landing.js";

const app = new Elysia()
  .get("/", () => new Response(renderLanding(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } }))
  .all("/mcp", ({ request }) => mcp.fetch(request))
  .get("/health", () => ({ status: "ok", service: "rzd-api", version: "4.0.0" }));

export default app;
