import { describe, expect, test } from "bun:test";
import app from "../app.ts";
import mcp from "../mcp.ts";

describe("Vercel functions", () => {
  test("exposes a health response", async () => {
    const response = await app.handle(new Request("https://example.vercel.app/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "rzd-api", version: "4.0.0" });
  });

  test("supports an MCP initialize request", async () => {
    const response = await mcp.fetch(new Request("https://example.vercel.app/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"serverInfo"');
  });

  test("exposes all MCP tools", async () => {
    const response = await mcp.fetch(new Request("https://example.vercel.app/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }));
    const body = await response.text();
    expect(response.status).toBe(200);
    for (const name of [
      "search_tickets", "find_stations", "get_carriages", "get_train_availability",
      "get_minimal_prices", "get_car_scheme", "get_car_images", "get_route_stations",
    ]) expect(body).toContain(`\"name\":\"${name}\"`);
  });
});
