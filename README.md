# RZD API for Bun

Типизированный асинхронный клиент на Bun/TypeScript и MCP-сервер для
неофициального API [`ticket.rzd.ru`](https://ticket.rzd.ru). Проект не связан с
ОАО «РЖД»; внутренние endpoint и схемы ответов могут меняться без предупреждения.

## Возможности

- поиск прямых поездов в одну сторону и туда-обратно;
- поиск станций и разрешение названий в коды;
- календарь поездов и минимальные цены;
- вагоны, места, схемы, изображения и станции маршрута;
- поиск полностью свободного купе по диапазону дат;
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
`getCarImages`, `getRouteStations`, `searchFullCompartments`.

## Полное купе

`searchFullCompartments` и MCP-инструмент `search_full_compartments` перебирают
диапазон дат (не более 31 дня) и разделяют два разных ответа:

- `confirmed` — API вернул нужные места внутри одного купе (`FreePlacesByCompartments`),
  указаны номер вагона, номер купе и сами места;
- `candidates` — свободных мест в вагоне достаточно, но одно купе не подтверждено:
  `places_not_in_one_compartment` (места в разных купе) или
  `compartment_layout_missing` (в ответе нет разбивки по купе).

Суммарное число свободных мест никогда не переводит вагон в `confirmed`. Инвариант
закреплён тестами на фикстурах в `tests/fixtures/`, поэтому изменение парсера не может
незаметно вернуть более смелую формулировку.

Поле `checkedAt` содержит момент проверки по московскому времени: наличие мест
устаревает за минуты. Даты, которые не удалось проверить, попадают в `errors`,
а не молча превращаются в «мест нет».

Готовая инструкция для ассистента лежит в `skills/find-full-compartment/`.

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

Проект содержит Vercel Functions без web-фреймворка:

- `https://<project>.vercel.app/` — страница с краткой документацией;
- `https://<project>.vercel.app/mcp` — публичный Streamable HTTP MCP;
- `https://<project>.vercel.app/health` — healthcheck.

Страница собирается в `src/landing.ts` из того же `registerMcpTools`, что
регистрирует инструменты в MCP: новый инструмент без русского описания роняет
сборку страницы, поэтому таблица не может разойтись с сервером.

Vercel entrypoint использует Elysia, официальный `mcp-handler` и Bun Runtime.
Маршруты принадлежат самому приложению; Vercel rewrites не используются.

Endpoint РЖД можно переопределить переменными окружения `RZD_BASE_URL` и
`RZD_B2B_BASE_URL`. Значения не должны храниться в репозитории.

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
