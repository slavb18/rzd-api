FROM oven/bun:1.3.14-slim

ENV MCP_TRANSPORT=streamable-http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=8000

WORKDIR /app
COPY package.json bun.lock tsconfig.json README.md LICENSE ./
RUN bun install --frozen-lockfile --production
COPY src/ src/

USER bun
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "const r=await fetch('http://127.0.0.1:8000/health');process.exit(r.ok?0:1)"
CMD ["bun", "run", "src/mcp.ts"]
