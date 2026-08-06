.PHONY: install test typecheck check run run-http docker-build docker-up docker-down

install:
	bun install --frozen-lockfile

test:
	bun test

typecheck:
	bun run typecheck

check:
	bun run check

run:
	bun run mcp

run-http:
	bun run mcp:http

docker-build:
	docker build -t rzd-api:4.0.0 .

docker-up:
	docker compose up -d

docker-down:
	docker compose down
