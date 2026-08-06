import { createMcpHandler } from "mcp-handler";
import { registerMcpTools, serverInstructions } from "./src/mcp-server.js";

export const runtime = "nodejs";

const handler = createMcpHandler((server) => {
  registerMcpTools(server as unknown as Parameters<typeof registerMcpTools>[0]);
}, {
  serverInfo: { name: "RZD API", version: "4.0.0" },
  instructions: serverInstructions,
});

async function fetch(request: Request): Promise<Response> {
  try {
    return await handler(request);
  } catch (error) {
    console.error("MCP request failed", error);
    return Response.json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    }, { status: 500 });
  }
}

export default { fetch };
