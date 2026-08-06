import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "../src/mcp-server.ts";

async function fetch(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return Response.json({ error: "unauthorized" }, {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer();
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
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
