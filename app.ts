import { Elysia } from "elysia";
import mcp from "./mcp.js";

const app = new Elysia()
  .all("/mcp", ({ request }) => mcp.fetch(request))
  .get("/health", () => ({ status: "ok", service: "rzd-api", version: "4.0.0" }));

export default app;
