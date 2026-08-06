#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp-server.js";

class RateLimiter {
  readonly requests = new Map<string, number[]>();
  constructor(readonly limit: number) {}
  check(key: string): number { if (!this.limit) return 0; const now = Date.now(), cutoff = now - 60_000; const values = (this.requests.get(key) ?? []).filter((at) => at > cutoff); if (values.length >= this.limit) return Math.max(1, Math.ceil((60_000 - (now - values[0]!)) / 1000)); values.push(now); this.requests.set(key, values); return 0; }
}

const transport = Bun.env.MCP_TRANSPORT ?? "stdio";
if (transport === "stdio") {
  await createMcpServer().connect(new StdioServerTransport());
} else if (transport === "streamable-http") {
  const hostname = Bun.env.MCP_HOST ?? "127.0.0.1";
  const port = positiveInt(Bun.env.MCP_PORT ?? "8000", "MCP_PORT", 65_535);
  const limit = positiveInt(Bun.env.MCP_RATE_LIMIT_PER_MINUTE ?? "60", "MCP_RATE_LIMIT_PER_MINUTE", Number.MAX_SAFE_INTEGER, true);
  const token = Bun.env.MCP_AUTH_TOKEN;
  if (token && token.length < 32) fail("MCP_AUTH_TOKEN must contain at least 32 characters.");
  if (!isLoopback(hostname) && !token) fail("MCP_AUTH_TOKEN is required when MCP_HOST is not loopback.");
  const rateLimiter = new RateLimiter(limit);
  Bun.serve({
    hostname, port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") return Response.json({ status: "ok", service: "rzd-api", version: "4.0.0" });
      if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
      if (!hostAllowed(request.headers.get("host"), hostname)) return Response.json({ error: "invalid_host" }, { status: 421 });
      if (token && !constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${token}`)) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
      const retryAfter = rateLimiter.check(token ? `token:${token}` : `ip:${request.headers.get("x-forwarded-for") ?? "local"}`);
      if (retryAfter) return Response.json({ error: "rate_limit_exceeded", retry_after: retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
      const mcpTransport = new WebStandardStreamableHTTPServerTransport();
      const server = createMcpServer();
      await server.connect(mcpTransport);
      return mcpTransport.handleRequest(request);
    },
  });
  console.error(`RZD MCP server listening on http://${hostname}:${port}/mcp`);
} else fail("MCP_TRANSPORT must be 'stdio' or 'streamable-http'.");

function positiveInt(raw: string, name: string, max: number, allowZero = false): number { const value = Number(raw), min = allowZero ? 0 : 1; if (!Number.isInteger(value) || value < min || value > max) fail(`${name} must be between ${min} and ${max}.`); return value; }
function isLoopback(host: string): boolean { return ["localhost", "127.0.0.1", "::1"].includes(host.toLowerCase()) || host.startsWith("127."); }
function hostAllowed(header: string | null, configured: string): boolean { const custom = Bun.env.MCP_ALLOWED_HOSTS?.split(",").map((v) => v.trim()).filter(Boolean); if (custom?.length) return header !== null && custom.some((value) => matchHost(header, value)); const host = header?.replace(/^\[|\](?=:|$)/g, "").split(":")[0]; return host === "localhost" || host === "127.0.0.1" || host === "::1" || (configured !== "0.0.0.0" && configured !== "::" && host === configured); }
function matchHost(actual: string, pattern: string): boolean { return pattern.endsWith(":*") ? actual.split(":")[0] === pattern.slice(0, -2).replace(/^\[|\]$/g, "") : actual === pattern; }
function constantTimeEqual(left: string, right: string): boolean { const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right); let result = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) result |= (a[i % Math.max(a.length, 1)] ?? 0) ^ (b[i % Math.max(b.length, 1)] ?? 0); return result === 0; }
function fail(message: string): never { console.error(message); process.exit(2); }
