import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const client = new Client({ name: "probe", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["run", "src/mcp.ts"], cwd: "/home/slavb18/work/rzd-api" }));
const started = Date.now();
const result: any = await client.callTool({ name: "search_full_compartments", arguments: {
  from_station: "2000000", to_station: "2034130", date_from: "2026-09-01", date_to: "2026-09-30", places: 4,
} });
for (const block of result.content) {
  if (block.type === "text") { const r = JSON.parse(block.text); console.log(`подтверждено ${r.confirmed.length}, запросов ${r.requests}, ${Date.now() - started}ms`); console.log("первое:", JSON.stringify(r.confirmed[0]).slice(0, 150)); }
  else { const bytes = Buffer.from(block.data, "base64"); await Bun.write("/tmp/claude-1000/-home-slavb18-work-rzd-api/d1f949db-81fe-403d-96b4-df9d1aa81a5e/scratchpad/default.png", bytes); console.log("КАРТИНКА:", block.mimeType, Math.round(bytes.length / 1024), "KB"); }
}
await client.close();
