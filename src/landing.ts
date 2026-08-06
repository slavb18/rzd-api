import { registerMcpTools } from "./mcp-server.js";

export interface ToolSummary { name: string; summary: string }

/** Russian one-liners for the landing page. The catalogue is built by running the real MCP
 *  registration, so a new tool without a summary here fails loudly instead of quietly
 *  disappearing from the documentation. */
const summaries: Record<string, string> = {
  search_tickets: "Поезда на дату между двумя станциями",
  search_full_compartments: "Полностью свободные купе за диапазон дат",
  find_stations: "Станции и их коды по названию",
  get_carriages: "Вагоны, свободные места и цены у поезда",
  get_train_availability: "Даты, когда поезд ходит",
  get_minimal_prices: "Минимальные цены по датам",
  get_car_scheme: "Схема конкретного вагона",
  get_car_images: "Фотографии вагона",
  get_route_stations: "Остановки поезда по маршруту",
};

export function toolCatalog(): ToolSummary[] {
  const catalog: ToolSummary[] = [];
  registerMcpTools({ registerTool: (name: string) => { catalog.push({ name, summary: summaries[name] ?? missing(name) }); } } as never);
  return catalog;
}

export function renderLanding(endpoint = "https://rzd-api.vercel.app/mcp"): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RZD MCP — поиск билетов РЖД в диалоге с ассистентом</title>
<meta name="description" content="MCP-сервер к неофициальному API РЖД: поезда, вагоны, места и полностью свободные купе прямо в диалоге с ассистентом.">
<style>${styles()}</style>
</head>
<body>
<main>
  <header class="hero">
    <p class="eyebrow">неофициальный · только чтение · mcp</p>
    <h1>Четыре места — <span class="accent">ещё не купе</span></h1>
    <p class="lead">MCP-сервер к неофициальному API РЖД. Ищет поезда, вагоны и места прямо в диалоге с ассистентом — и отличает подтверждённое купе от четырёх мест, разбросанных по вагону.</p>
    <div class="endpoint">
      <span class="endpoint-label">endpoint</span>
      <code id="endpoint">${escape(endpoint)}</code>
      <button type="button" id="copy" data-endpoint="${escape(endpoint)}">Скопировать</button>
    </div>
    ${scheme()}
  </header>

  <section class="note" aria-label="Дисклеймер">
    <p>Проект не связан с ОАО «РЖД» и использует внутренние endpoint сайта <code>ticket.rzd.ru</code>, которые могут измениться без предупреждения. Все инструменты только читают данные: сервер не логинится, не принимает документы и не покупает билеты. Наличие мест и цены меняются в реальном времени — перед покупкой проверьте их на официальном сайте или в приложении РЖД.</p>
  </section>

  <section aria-labelledby="connect">
    <h2 id="connect">Как подключить</h2>
    <div class="cards">
      <article class="card">
        <h3>ChatGPT</h3>
        <ol>
          <li>Включите режим разработчика в настройках.</li>
          <li>Создайте приложение и подключите его по URL сервера.</li>
          <li>Укажите адрес <code>${escape(endpoint)}</code>.</li>
          <li>Авторизация — «без авторизации»: сервер только читает данные.</li>
          <li>Запустите сканирование инструментов и подтвердите предупреждение о непроверенном сервере.</li>
        </ol>
        <p class="card-note">Названия пунктов зависят от тарифа и этапа rollout.</p>
      </article>
      <article class="card">
        <h3>Codex и локальные клиенты</h3>
        <p>Удалённый сервер по Streamable HTTP:</p>
        <pre><code>codex mcp add rzd --url ${escape(endpoint)}</code></pre>
        <p>Или локальный STDIO из клона репозитория:</p>
        <pre><code>codex mcp add rzd -- bun run /path/to/rzd-api/src/mcp.ts</code></pre>
      </article>
      <article class="card">
        <h3>Свой экземпляр</h3>
        <pre><code>git clone https://github.com/slavb18/rzd-api
bun install
bun run mcp:http</code></pre>
        <p class="card-note">Endpoint РЖД переопределяется переменными <code>RZD_BASE_URL</code> и <code>RZD_B2B_BASE_URL</code> — например, на свой reverse proxy, если прямой доступ закрыт.</p>
      </article>
    </div>
  </section>

  <section aria-labelledby="ask">
    <h2 id="ask">Как спрашивать</h2>
    <p>Обычным языком — параметры ассистент достроит сам:</p>
    <dl class="examples">
      <dt><code>@rzd Москва → Владивосток, полное купе, с 1 по 30 сентября 2026 с картинкой</code></dt>
      <dd>«Полное купе» — это четыре места за одной дверью. Схема вагона придёт картинкой, свободные места на ней синие.</dd>
      <dt><code>@rzd СВ на двоих Москва — Петербург в ближайшие выходные</code></dt>
      <dd>В двухместном вагоне за дверью два места, а не четыре, поэтому искать нужно именно два — иначе не подтвердится ничего.</dd>
      <dt><code>@rzd целое купе во Владивосток в сентябре</code></dt>
      <dd>Голый месяц берётся целиком. Диапазон ограничен 31 днём: если попросить больше, ассистент проверит первые 31 и скажет об этом.</dd>
    </dl>
    <p class="hint">В ответе подтверждённые купе и отдельно кандидаты — вагоны, где мест хватает, но API не подтвердил их одним купе. Номера мест приходят как есть: <code>36Ж</code> — место в женском купе, <code>6С</code> — в смешанном. Ответ помечен временем проверки: наличие устаревает за минуты.</p>
  </section>

  <section aria-labelledby="tools">
    <h2 id="tools">Инструменты</h2>
    <table>
      <thead><tr><th scope="col">Инструмент</th><th scope="col">Что делает</th></tr></thead>
      <tbody>${toolCatalog().map((tool) => `<tr><td><code>${escape(tool.name)}</code></td><td>${escape(tool.summary)}</td></tr>`).join("")}</tbody>
    </table>
  </section>

  <footer>
    <a href="https://github.com/slavb18/rzd-api">Исходники на GitHub</a>
    <a href="https://habr.com/ru/articles/1067268/">Статья о том, как это собрано</a>
    <a href="https://modelcontextprotocol.io/">Что такое MCP</a>
  </footer>
</main>
<script>
document.getElementById("copy")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(button.dataset.endpoint);
    button.textContent = "Скопировано";
    setTimeout(() => { button.textContent = "Скопировать"; }, 2000);
  } catch { getSelection()?.selectAllChildren(document.getElementById("endpoint")); }
});
</script>
</body>
</html>`;
}

function scheme(): string {
  return `<figure class="scheme">
    <div class="car">
      <p class="car-head"><span class="car-name">вагон 07</span><span class="tag tag-ok">подтверждено</span></p>
      <div class="car-body">${kupe(1, [1, 2, 3, 4])}${kupe(2, [])}${kupe(3, [11])}</div>
      <figcaption>Четыре места за одной дверью: API перечислил их внутри купе 1.</figcaption>
    </div>
    <div class="car">
      <p class="car-head"><span class="car-name">вагон 09</span><span class="tag tag-maybe">кандидат</span></p>
      <div class="car-body">${kupe(1, [1, 2])}${kupe(2, [5, 6])}${kupe(3, [])}</div>
      <figcaption>Тоже четыре свободных места — но в двух разных купе. Семья поедет за разными дверями.</figcaption>
    </div>
  </figure>`;
}

function kupe(index: number, free: number[]): string {
  const seat = (place: number) => `<span class="seat${free.includes(place) ? " seat-free" : ""}">${place}</span>`;
  return `<div class="kupe" role="img" aria-label="Купе ${index}: свободно мест — ${free.length}">${[index * 4 - 2, index * 4].map(seat).join("")}${[index * 4 - 3, index * 4 - 1].map(seat).join("")}</div>`;
}

function styles(): string {
  return `
:root {
  color-scheme: light dark;
  --bg: #f2f4f8; --surface: #ffffff; --ink: #0d1421; --muted: #5c6880;
  --line: #d7deea; --amber: #9c6512; --mint: #1c7a5b; --seat: #c9d2e0;
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1421; --surface: #141e2f; --ink: #e8edf6; --muted: #93a0b8;
    --line: #24314a; --amber: #e8a33d; --mint: #4cc79b; --seat: #2b3950;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-sans); font-size: 17px; line-height: 1.6; -webkit-text-size-adjust: 100%; }
main { max-width: 46rem; margin: 0 auto; padding: 4rem 1.25rem 5rem; }
section { margin-top: 3.5rem; }
h1 { margin: 0.75rem 0 1rem; font-size: clamp(2.1rem, 7vw, 3.1rem); line-height: 1.08; letter-spacing: -0.03em; font-weight: 800; text-wrap: balance; }
h2 { margin: 0 0 1.25rem; font-size: 1.35rem; letter-spacing: -0.015em; }
h3 { margin: 0 0 0.75rem; font-size: 1rem; letter-spacing: -0.01em; }
p { margin: 0 0 1rem; }
a { color: inherit; text-underline-offset: 3px; text-decoration-thickness: 1px; }
a:hover { color: var(--amber); }
:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; border-radius: 2px; }
code { font-family: var(--font-mono); font-size: 0.86em; }
pre { max-width: 100%; margin: 0 0 1rem; padding: 0.85rem 1rem; overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
pre code { font-size: 0.82rem; line-height: 1.65; }
.accent { color: var(--amber); }
.eyebrow { font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); margin: 0; }
.lead { font-size: 1.12rem; color: var(--muted); max-width: 34rem; }
.endpoint { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin: 1.75rem 0 0; padding: 0.7rem 0.9rem; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.endpoint-label { font-family: var(--font-mono); font-size: 0.66rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
.endpoint code { flex: 1 1 auto; font-size: 0.9rem; word-break: break-all; }
#copy { font: inherit; font-size: 0.8rem; padding: 0.3rem 0.75rem; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 999px; cursor: pointer; }
#copy:hover { border-color: var(--amber); color: var(--amber); }
.scheme { display: grid; gap: 1.25rem; margin: 2.5rem 0 0; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.car { min-width: 0; padding: 1rem 1.1rem 1.1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.car-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin: 0 0 0.9rem; }
.car-name { font-family: var(--font-mono); font-size: 0.74rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
.tag { font-family: var(--font-mono); font-size: 0.66rem; letter-spacing: 0.1em; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 999px; border: 1px solid currentColor; }
.tag-ok { color: var(--mint); }
.tag-maybe { color: var(--amber); }
.car-body { display: flex; gap: 0.5rem; }
.kupe { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; padding: 4px; border: 1px solid var(--line); border-radius: 6px; }
.seat { display: grid; place-items: center; width: 1.85rem; height: 1.6rem; font-family: var(--font-mono); font-size: 0.7rem; color: var(--muted); background: var(--seat); border-radius: 3px; }
.seat-free { color: var(--surface); background: var(--mint); font-weight: 600; }
.scheme figcaption { margin-top: 0.9rem; font-size: 0.85rem; color: var(--muted); }
.note { padding: 1rem 1.15rem; border-left: 3px solid var(--amber); background: var(--surface); border-radius: 0 8px 8px 0; }
.note p { margin: 0; font-size: 0.92rem; color: var(--muted); }
.cards { display: grid; gap: 1rem; }
.card { min-width: 0; padding: 1.15rem 1.25rem; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.card p:last-child, .card pre:last-child, .card ol:last-child { margin-bottom: 0; }
.card ol { margin: 0 0 1rem; padding-left: 1.15rem; font-size: 0.95rem; }
.card li { margin-bottom: 0.3rem; }
.card-note { font-size: 0.85rem; color: var(--muted); }
.hint { font-size: 0.92rem; color: var(--muted); }
.examples { margin: 0 0 1rem; }
.examples dt { margin-bottom: 0.4rem; padding: 0.7rem 0.9rem; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
.examples dt code { font-size: 0.85rem; }
.examples dd { margin: 0 0 1.4rem; padding-left: 0.9rem; border-left: 2px solid var(--line); font-size: 0.9rem; color: var(--muted); }
.examples dd:last-child { margin-bottom: 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
th, td { text-align: left; padding: 0.6rem 0.75rem 0.6rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-family: var(--font-mono); font-size: 0.68rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); font-weight: 400; }
td:first-child { white-space: nowrap; padding-right: 1.25rem; }
footer { display: flex; flex-wrap: wrap; gap: 1.25rem; margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px solid var(--line); font-size: 0.9rem; }
@media (max-width: 30rem) { main { padding-top: 2.5rem; } }`;
}

function escape(value: string): string { return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]!); }
function missing(name: string): never { throw new Error(`The landing page has no Russian summary for the MCP tool ${name}.`); }
