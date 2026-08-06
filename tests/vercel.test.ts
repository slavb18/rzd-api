import { afterEach, describe, expect, test } from "bun:test";
import health from "../api/health.ts";
import mcp from "../api/mcp.ts";

const originalToken = process.env.MCP_AUTH_TOKEN;
afterEach(() => {
  if (originalToken === undefined) delete process.env.MCP_AUTH_TOKEN;
  else process.env.MCP_AUTH_TOKEN = originalToken;
});

describe("Vercel Bun functions", () => {
  test("exposes a health response", async () => {
    const response = health.fetch();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "rzd-api", version: "4.0.0" });
  });

  test("supports an MCP initialize request", async () => {
    delete process.env.MCP_AUTH_TOKEN;
    const response = await mcp.fetch(new Request("https://example.vercel.app/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"serverInfo"');
  });

  test("honors an optional bearer token", async () => {
    process.env.MCP_AUTH_TOKEN = "a-secure-token-with-at-least-32-characters";
    const response = await mcp.fetch(new Request("https://example.vercel.app/api/mcp", { method: "POST" }));
    expect(response.status).toBe(401);
  });
});
