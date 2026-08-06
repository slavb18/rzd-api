# RZD API for Bun

Типизированный асинхронный клиент на Bun/TypeScript и MCP-сервер для
неофициального API [`ticket.rzd.ru`](https://ticket.rzd.ru). Проект не связан с
ОАО «РЖД»; внутренние endpoint и схемы ответов могут меняться без предупреждения.

## Возможности

- поиск прямых поездов в одну сторону и туда-обратно;
- поиск станций и разрешение названий в коды;
- календарь поездов и минимальные цены;
- вагоны, места, схемы, изображения и станции маршрута;
- MCP через STDIO и Streamable HTTP;
- retries, таймауты и LRU-кэш станций.

## Установка

Требуется Bun 1.2 или новее.

```sh
bun install
```

## TypeScript API

```ts
import { RzdClient } from "rzd-api";

const client = new RzdClient();
try {
  const routes = await client.searchTickets(
    "Москва",
    "Санкт-Петербург",
    "2026-09-01",
    { adults: 1 },
  );
  console.log(routes);
} finally {
  client.close();
}
```

Основные методы: `searchTickets`, `findStations`, `resolveStationCode`,
`getCarriages`, `getTrainAvailability`, `getMinimalPrices`, `getCarScheme`,
`getCarImages`, `getRouteStations`.

## MCP

Локальный STDIO:

```sh
bun run mcp
```

Streamable HTTP на loopback:

```sh
bun run mcp:http
curl http://127.0.0.1:8000/health
```

При публикации на non-loopback адресе нужен Bearer-токен длиной не менее 32
символов:

```sh
MCP_TRANSPORT=streamable-http \
MCP_HOST=0.0.0.0 \
MCP_AUTH_TOKEN="replace-with-a-random-token-at-least-32-characters" \
bun run src/mcp.ts
```

Endpoint: `http://localhost:8000/mcp`. Переменные окружения:
`MCP_PORT`, `MCP_RATE_LIMIT_PER_MINUTE`, `MCP_ALLOWED_HOSTS`.

Подключение к Codex:

```sh
codex mcp add rzd -- bun run /absolute/path/to/rzd-api/src/mcp.ts
```

## Docker

```sh
export MCP_AUTH_TOKEN="replace-with-a-random-token-at-least-32-characters"
docker compose up -d
```

## Vercel

Проект содержит нативные Bun Functions без web-фреймворка:

- `https://<project>.vercel.app/api/mcp` — Streamable HTTP MCP;
- `https://<project>.vercel.app/api/health` — healthcheck.

Для закрытого MCP задайте `MCP_AUTH_TOKEN` в настройках Vercel. Без этой
переменной endpoint публичный.

```sh
vercel deploy
```

## Разработка

```sh
bun run check
```

## Безопасность

Как и прежняя Python-версия, клиент отключает проверку TLS-сертификата API РЖД
для совместимости. Не передавайте ему секреты или учётные данные.

## Лицензия

MIT
