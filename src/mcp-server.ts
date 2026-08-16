import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { schemeImageKinds } from "./api.js";
import { RzdClient } from "./client.js";
import { configFromEnvironment } from "./config.js";
import { logEvent, schemeImageUrl } from "./log.js";

const station = z.string().describe("Station name or numeric station code");
const date = z.string().describe("Date in DD.MM.YYYY, YYYY-MM-DD, or ISO format");
const includeRaw = z.boolean().default(false).describe("Also return the untouched upstream payload in `raw` beside every parsed field. Off by default: it repeats what has already been parsed out and can be thirty times the size of the answer, large enough for a client to drop the result. Turn it on only to read a field this server does not parse.");

/** Reaches every client at initialize, so it carries the two choices a model gets wrong when
 *  it has only tool names to go by: which tool answers "a whole compartment", and which one
 *  can actually show a picture. */
export const serverInstructions = [
  "Use these read-only tools to search the unofficial ticket.rzd.ru API. Availability and the internal RZD response schemas change without notice. A date already gone is refused, except by search_full_compartments, which simply starts its range today.",
  "For a whole compartment - four berths behind one door rather than four berths somewhere in the same carriage - call search_full_compartments. It answers that question from the carriage response instead of leaving it to inference, returns the nearest few dates, and draws the compartment it found. Never look for a picture elsewhere - photographs found on the web are of some other carriage.",
  "To show the carriage, call get_car_scheme with include_image and the compartment's berths in free_places: it returns the drawing as a PNG with those berths filled blue. get_car_images returns titles and identifiers only, its paths do not resolve to an image, and photographs found elsewhere are not evidence about this carriage.",
  "Both tools return the drawing three ways, because clients differ in what reaches the reader: an image block, a resource_link, and the fields schemeImageUrl and schemeImageMarkdown in the text. Copy schemeImageMarkdown into your reply verbatim - it is a finished markdown image, and in a client that passes only text through it is the one form in which the reader sees the carriage at all. Do not merely mention that a drawing exists.",
].join("\n\n");

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "RZD API", version: "4.0.0" }, { instructions: serverInstructions });

  registerMcpTools(server);
  return server;
}

type ToolServer = Pick<McpServer, "registerTool">;

export function registerMcpTools(server: ToolServer): void {
  register(server, "search_tickets", "Search direct RZD routes by station name/code and departure date.", {
    from_station: station, to_station: station, departure_date: date, return_date: date.optional(), adults: z.number().int().min(1).default(1), children: z.number().int().min(0).default(0), only_with_seats: z.boolean().default(true), include_transfers: z.boolean().default(false), transport_type: z.enum(["all", "trains", "suburban"]).default("all"), include_raw: includeRaw,
  }, async (args) => usingClient((client) => client.searchTickets(args.from_station, args.to_station, args.departure_date, { returnDate: args.return_date, adults: args.adults, children: args.children, onlyWithSeats: args.only_with_seats, includeTransfers: args.include_transfers, transportType: args.transport_type })));
  register(server, "search_full_compartments", "Find compartments whose places are all free, over an inclusive date range of at most 31 days. A match is confirmed only when the carriage response lists the requested places inside one compartment; carriages with enough free places but no such confirmation are returned as candidates. Dates the scan did not reach come back in unchecked - they were not searched, they are not empty. A long range is answered within seconds by design: continue from the first unchecked date to look further. A range that starts in the past is moved to today rather than refused, so a whole month can be passed as it is.", {
    from_station: station, to_station: station, date_from: date, date_to: date, places: z.number().int().min(2).default(4), max_results: z.number().int().min(1).max(500).default(3).describe("How many options to return; the scan stops once this many compartments are confirmed"), max_requests: z.number().int().min(1).max(1000).default(150).describe("Upstream request budget for the whole scan; dates left over are returned in unchecked"), include_image: z.boolean().default(true).describe("Return the carriage drawing of the first confirmed compartment, its berths filled blue"), max_seconds: z.number().min(1).max(60).default(9).describe("Wall-clock budget; the scan returns what it has and lists the rest in unchecked"),
  }, async (args) => usingClient((client) => client.searchFullCompartments(args.from_station, args.to_station, args.date_from, args.date_to, { places: args.places, maxResults: args.max_results, maxRequests: args.max_requests, image: args.include_image, maxSeconds: args.max_seconds })), imageAndText);
  register(server, "find_stations", "Find station candidates, including synonym matches.", { query: z.string(), transport_type: z.string().default("rail,suburban"), group_results: z.boolean().default(true), include_raw: includeRaw }, async (args) => usingClient((client) => client.findStations(args.query, { transportType: args.transport_type, groupResults: args.group_results })));
  register(server, "get_carriages", "Get carriage and seat availability details for a train.", { from_station: station, to_station: station, departure_date: date, departure_time: z.string(), train_number: z.string(), provider: z.string().default("P1"), include_raw: includeRaw }, async (args) => usingClient((client) => client.getCarriages(args.from_station, args.to_station, args.departure_date, args.departure_time, args.train_number, args.provider)));
  register(server, "get_train_availability", "Get dates with available trains for a direction.", { from_station: station, to_station: station, date_from: date, date_to: date, include_raw: includeRaw }, async (args) => usingClient((client) => client.getTrainAvailability(args.from_station, args.to_station, args.date_from, args.date_to)));
  register(server, "get_minimal_prices", "Get the minimum published prices from a selected date.", { from_station: station, to_station: station, date_from: date, include_raw: includeRaw }, async (args) => usingClient((client) => client.getMinimalPrices(args.from_station, args.to_station, args.date_from)));
  const metadata = { departure_date: date, departure_time: z.string(), train_number: z.string(), car_number: z.string(), car_sub_type: z.string(), service_class: z.string(), carrier: z.string(), car_numeration: z.string().default("FromHead"), include_raw: includeRaw };
  register(server, "get_car_scheme", "Get carriage scheme metadata, including public links to the scheme drawing. Set include_image to embed the drawing as a PNG; free_places are filled blue and selected_places red, matching the colours ticket.rzd.ru uses.", {
    ...metadata, include_image: z.boolean().default(false), image_kind: z.enum(schemeImageKinds).default("PcFirstStorey"), free_places: z.array(z.number().int().min(1)).default([]).describe("Place numbers to fill blue, the colour the site uses for a free berth"), selected_places: z.array(z.number().int().min(1)).default([]).describe("Place numbers to fill red, the colour the site uses for the berths being booked"),
  }, async (args) => usingClient(async (client) => {
    const scheme = await client.getCarScheme(args.departure_date, args.departure_time, args.train_number, args.car_number, args.car_sub_type, args.service_class, args.carrier, args.car_numeration);
    if (!args.include_image || scheme.schemeId === undefined || !scheme.imageUrls.some((image) => image.kind === args.image_kind)) return scheme;
    // The carriage number comes from the call, not from the scheme: RZD returns the drawing of
    // a layout, and its own CarNumber field is null. Without it the caption said "вагон ?".
    // The link is built for the same reason the search builds one: an image block is not a
    // picture in a client that only passes text through, and this tool was returning the block
    // alone - a drawing fetched and painted for nobody.
    const content = await client.getSchemeImage(scheme.schemeId, args.image_kind, { free: args.free_places, selected: args.selected_places });
    const url = schemeImageUrl(client.config.publicBaseUrl, scheme.schemeId, args.image_kind, args.free_places, args.selected_places);
    return { ...scheme, image: { ...content, url, carNumber: args.car_number } };
  }), imageAndText);
  register(server, "get_car_images", "List the interior photographs the carriage has: titles and identifiers only. The paths it returns do not resolve to an image, so it cannot illustrate an answer - use get_car_scheme with include_image for a picture of the carriage.", metadata, async (args) => usingClient((client) => client.getCarImages(args.departure_date, args.departure_time, args.train_number, args.car_number, args.car_sub_type, args.service_class, args.carrier, args.car_numeration)));
  register(server, "get_route_stations", "Get all stations for a train and direction.", { from_station: station, to_station: station, departure_date: date, departure_time: z.string(), train_number: z.string(), provider: z.string().default("P1"), include_raw: includeRaw }, async (args) => usingClient((client) => client.getRouteStations(args.from_station, args.to_station, args.departure_date, args.departure_time, args.train_number, args.provider)));
}

/** Every parsed model carries the payload it was parsed from, which is the escape hatch when
 *  the upstream schema moves - and 97% of a ticket search by weight, all of it a repeat of
 *  fields already named beside it. A result that large is dropped by the client before the
 *  model sees a single train, so the duplicate leaves unless it was asked for. */
export function withoutRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => withoutRaw(entry));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => key === "raw" ? [] : [[key, withoutRaw(entry)]]));
}

/** The sentence beside the drawing is all a text-only client learns about it, so it says what
 *  the picture shows and nothing it does not know: get_car_scheme is called with berths of the
 *  caller's choosing, and those need not be a compartment at all. */
export function describeDrawing(image: { carNumber?: string; compartmentNumber?: string; url?: string }): { shows: string; name: string; markdown?: string } {
  const car = image.carNumber ? [image.carNumber] : [], compartment = image.compartmentNumber ? [image.compartmentNumber] : [];
  const said = [...car.map((number) => `вагон ${number}`), ...compartment.map((number) => `купе ${number}`), "свободные места залиты синим"];
  const shows = said.join(", ");
  // ChatGPT hands a connector's answer to the model as a JSON string: neither the image block
  // nor the resource_link survives that, and the only picture a reader can get is one the model
  // writes into its own reply. A bare URL it read past; the finished markdown it pastes.
  return { shows, name: `${["carriage", ...car, ...compartment.flatMap((number) => ["compartment", number])].join("-")}.png`, markdown: image.url ? `![${shows}](${image.url})` : undefined };
}

/** Splits a result carrying an `image` into a text block and a real image block, so the
 *  drawing arrives as a picture rather than as base64 buried in JSON. */
function imageAndText(value: unknown): ContentBlock[] {
  const image = (value as { image?: { data: string; mimeType: string; url?: string; carNumber?: string; compartmentNumber?: string } }).image;
  const { image: _omitted, ...rest } = value as Record<string, unknown>;
  if (!image) return [{ type: "text", text: JSON.stringify(rest, null, 2) }];
  const drawing = describeDrawing(image);
  return [
    // The link stays in the text, and goes first: a client that drops image blocks would
    // otherwise have nothing to show, and one that truncates a long result would cut the link
    // off the end - both send it looking for a photograph of some other carriage instead.
    { type: "text", text: JSON.stringify({ schemeImageUrl: image.url, schemeImageShows: drawing.shows, ...(drawing.markdown ? { schemeImageMarkdown: drawing.markdown } : {}), ...rest }, null, 2) },
    // Three ways to arrive at the same drawing, because clients differ in what they surface:
    // the picture itself, annotated as meant for the reader, and a plain link to it.
    { type: "image", data: image.data, mimeType: image.mimeType, annotations: { audience: ["user"], priority: 0.9 } },
    ...(image.url ? [{ type: "resource_link" as const, uri: image.url, name: drawing.name, description: "Carriage drawing with the free berths of this compartment filled blue", mimeType: "image/png" }] : []),
  ];
}

type Shape = Record<string, z.ZodTypeAny>;
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; annotations?: { audience: string[]; priority: number } }
  | { type: "resource_link"; uri: string; name: string; description: string; mimeType: string };
function register<S extends Shape>(server: ToolServer, name: string, description: string, inputSchema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>, toContent: (value: unknown) => ContentBlock[] = (value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]): void {
  server.registerTool(name, { description, inputSchema: z.object(inputSchema), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } } as never, (async (args: Record<string, unknown>) => {
    const started = Date.now();
    try {
      const value = await handler(args as z.infer<z.ZodObject<S>>);
      const content = toContent(args.include_raw === true ? value : withoutRaw(value));
      logEvent({ tool: name, ms: Date.now() - started, ok: true, blocks: content.map((block) => block.type) });
      return { content };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logEvent({ tool: name, ms: Date.now() - started, ok: false, error: message.slice(0, 200) });
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  }) as never);
}

async function usingClient<T>(callback: (client: RzdClient) => Promise<T>): Promise<T> { const client = new RzdClient(configFromEnvironment()); try { return await callback(client); } finally { client.close(); } }
