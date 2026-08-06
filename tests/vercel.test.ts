import { describe, expect, test } from "bun:test";
import app from "../app.ts";
import mcp from "../mcp.ts";
import { toolCatalog } from "../src/landing.ts";

describe("landing page", () => {
  test("serves HTML at the site root", async () => {
    const response = await app.handle(new Request("https://example.vercel.app/"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("text/html");
  });

  test("documents the public MCP endpoint", async () => {
    expect(await page()).toContain("https://rzd-api.vercel.app/mcp");
  });

  test("lists every registered MCP tool with a Russian description", async () => {
    const html = await page();
    const catalog = toolCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    for (const tool of catalog) {
      expect(html).toContain(tool.name);
      expect(tool.summary).toMatch(/[а-яё]/i);
      expect(html).toContain(tool.summary);
    }
  });

  test("keeps the disclaimer on the page", async () => {
    expect(await page()).toContain("не связан");
  });
});

async function page(): Promise<string> { return app.handle(new Request("https://example.vercel.app/")).then((response) => response.text()); }

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
      "search_full_compartments",
    ]) expect(body).toContain(`\"name\":\"${name}\"`);
  });
});
