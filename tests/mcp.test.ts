import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client | undefined;
afterEach(async () => { await client?.close(); client = undefined; });

describe("MCP stdio protocol", () => {
  test("initializes and exposes all tools", async () => {
    client = new Client({ name: "rzd-test", version: "1.0.0" });
    const transport = new StdioClientTransport({ command: process.execPath, args: ["run", "src/mcp.ts"], cwd: import.meta.dir + "/.." });
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name).sort()).toEqual([
      "find_stations", "get_car_images", "get_car_scheme", "get_carriages",
      "get_minimal_prices", "get_route_stations", "get_train_availability", "search_tickets",
    ]);
  });
});
