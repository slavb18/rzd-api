import { createMcpHandler } from "mcp-handler";
import { registerMcpTools } from "../src/mcp-server.js";

export const runtime = "nodejs";

const handler = createMcpHandler((server) => {
  registerMcpTools(server as unknown as Parameters<typeof registerMcpTools>[0]);
}, {
  serverInfo: { name: "RZD API", version: "4.0.0" },
  instructions: "Use these read-only tools to search the unofficial ticket.rzd.ru API.",
});

async function fetch(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

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

function isAuthorized(request: Request): boolean {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) return true;
  return constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${token}`);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let result = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    result |= (a[index % Math.max(a.length, 1)] ?? 0) ^
      (b[index % Math.max(b.length, 1)] ?? 0);
  }
  return result === 0;
}

export default { fetch };
