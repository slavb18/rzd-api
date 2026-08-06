import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { schemeImageKinds } from "./api.js";
import { RzdClient } from "./client.js";
import { configFromEnvironment } from "./config.js";
import { logEvent } from "./log.js";

const station = z.string().describe("Station name or numeric station code");
const date = z.string().describe("Date in DD.MM.YYYY, YYYY-MM-DD, or ISO format");

/** Reaches every client at initialize, so it carries the two choices a model gets wrong when
 *  it has only tool names to go by: which tool answers "a whole compartment", and which one
 *  can actually show a picture. */
export const serverInstructions = [
  "Use these read-only tools to search the unofficial ticket.rzd.ru API. Dates must not be in the past, and both availability and the internal RZD response schemas change without notice.",
  "For a whole compartment - four berths behind one door rather than four berths somewhere in the same carriage - call search_full_compartments. It answers that question from the carriage response instead of leaving it to inference, returns the nearest few dates, and draws the compartment it found: the reply carries the carriage drawing with those berths filled blue, both as an image block and as a link in image.url. Show that link and never look for a picture elsewhere - photographs found on the web are of some other carriage.",
  "To show the carriage, call get_car_scheme with include_image and the compartment's berths in free_places: it returns the drawing as a PNG with those berths filled blue. get_car_images returns titles and identifiers only, its paths do not resolve to an image, and photographs found elsewhere are not evidence about this carriage.",
].join("\n\n");

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "RZD API", version: "4.0.0" }, { instructions: serverInstructions });

  registerMcpTools(server);
  return server;
}

type ToolServer = Pick<McpServer, "registerTool">;

export function registerMcpTools(server: ToolServer): void {
  register(server, "search_tickets", "Search direct RZD routes by station name/code and departure date.", {
    from_station: station, to_station: station, departure_date: date, return_date: date.optional(), adults: z.number().int().min(1).default(1), children: z.number().int().min(0).default(0), only_with_seats: z.boolean().default(true), include_transfers: z.boolean().default(false), transport_type: z.enum(["all", "trains", "suburban"]).default("all"),
  }, async (args) => usingClient((client) => client.searchTickets(args.from_station, args.to_station, args.departure_date, { returnDate: args.return_date, adults: args.adults, children: args.children, onlyWithSeats: args.only_with_seats, includeTransfers: args.include_transfers, transportType: args.transport_type })));
  register(server, "search_full_compartments", "Find compartments whose places are all free, over an inclusive date range of at most 31 days. A match is confirmed only when the carriage response lists the requested places inside one compartment; carriages with enough free places but no such confirmation are returned as candidates. Dates the scan did not reach come back in unchecked - they were not searched, they are not empty. A long range is answered within seconds by design: continue from the first unchecked date to look further.", {
    from_station: station, to_station: station, date_from: date, date_to: date, places: z.number().int().min(2).default(4), max_results: z.number().int().min(1).max(500).default(3).describe("How many options to return; the scan stops once this many compartments are confirmed"), max_requests: z.number().int().min(1).max(1000).default(150).describe("Upstream request budget for the whole scan; dates left over are returned in unchecked"), include_image: z.boolean().default(true).describe("Return the carriage drawing of the first confirmed compartment, its berths filled blue"), max_seconds: z.number().min(1).max(60).default(9).describe("Wall-clock budget; the scan returns what it has and lists the rest in unchecked"),
  }, async (args) => usingClient((client) => client.searchFullCompartments(args.from_station, args.to_station, args.date_from, args.date_to, { places: args.places, maxResults: args.max_results, maxRequests: args.max_requests, image: args.include_image, maxSeconds: args.max_seconds })), imageAndText);
  register(server, "find_stations", "Find station candidates, including synonym matches.", { query: z.string(), transport_type: z.string().default("rail,suburban"), group_results: z.boolean().default(true) }, async (args) => usingClient((client) => client.findStations(args.query, { transportType: args.transport_type, groupResults: args.group_results })));
  register(server, "get_carriages", "Get carriage and seat availability details for a train.", { from_station: station, to_station: station, departure_date: date, departure_time: z.string(), train_number: z.string(), provider: z.string().default("P1") }, async (args) => usingClient((client) => client.getCarriages(args.from_station, args.to_station, args.departure_date, args.departure_time, args.train_number, args.provider)));
  register(server, "get_train_availability", "Get dates with available trains for a direction.", { from_station: station, to_station: station, date_from: date, date_to: date }, async (args) => usingClient((client) => client.getTrainAvailability(args.from_station, args.to_station, args.date_from, args.date_to)));
  register(server, "get_minimal_prices", "Get the minimum published prices from a selected date.", { from_station: station, to_station: station, date_from: date }, async (args) => usingClient((client) => client.getMinimalPrices(args.from_station, args.to_station, args.date_from)));
  const metadata = { departure_date: date, departure_time: z.string(), train_number: z.string(), car_number: z.string(), car_sub_type: z.string(), service_class: z.string(), carrier: z.string(), car_numeration: z.string().default("FromHead") };
  register(server, "get_car_scheme", "Get carriage scheme metadata, including public links to the scheme drawing. Set include_image to embed the drawing as a PNG; free_places are filled blue and selected_places red, matching the colours ticket.rzd.ru uses.", {
    ...metadata, include_image: z.boolean().default(false), image_kind: z.enum(schemeImageKinds).default("PcFirstStorey"), free_places: z.array(z.number().int().min(1)).default([]).describe("Place numbers to fill blue, the colour the site uses for a free berth"), selected_places: z.array(z.number().int().min(1)).default([]).describe("Place numbers to fill red, the colour the site uses for the berths being booked"),
  }, async (args) => usingClient(async (client) => {
    const scheme = await client.getCarScheme(args.departure_date, args.departure_time, args.train_number, args.car_number, args.car_sub_type, args.service_class, args.carrier, args.car_numeration);
    if (!args.include_image || scheme.schemeId === undefined || !scheme.imageUrls.some((image) => image.kind === args.image_kind)) return scheme;
    return { ...scheme, image: await client.getSchemeImage(scheme.schemeId, args.image_kind, { free: args.free_places, selected: args.selected_places }) };
  }), imageAndText);
  register(server, "get_car_images", "List the interior photographs the carriage has: titles and identifiers only. The paths it returns do not resolve to an image, so it cannot illustrate an answer - use get_car_scheme with include_image for a picture of the carriage.", metadata, async (args) => usingClient((client) => client.getCarImages(args.departure_date, args.departure_time, args.train_number, args.car_number, args.car_sub_type, args.service_class, args.carrier, args.car_numeration)));
  register(server, "get_route_stations", "Get all stations for a train and direction.", { from_station: station, to_station: station, departure_date: date, departure_time: z.string(), train_number: z.string(), provider: z.string().default("P1") }, async (args) => usingClient((client) => client.getRouteStations(args.from_station, args.to_station, args.departure_date, args.departure_time, args.train_number, args.provider)));
}

/** Splits a result carrying an `image` into a text block and a real image block, so the
 *  drawing arrives as a picture rather than as base64 buried in JSON. */
function imageAndText(value: unknown): ContentBlock[] {
  const image = (value as { image?: { data: string; mimeType: string; url?: string } }).image;
  const { image: _omitted, ...rest } = value as Record<string, unknown>;
  // The link stays in the text: a client that drops image blocks would otherwise be left with
  // nothing to show, and goes looking for a photograph of some other carriage instead.
  const described = image ? { ...rest, image: { ...image, data: undefined, mimeType: undefined } } : rest;
  return [{ type: "text", text: JSON.stringify(described, null, 2) }, ...(image ? [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] : [])];
}

type Shape = Record<string, z.ZodTypeAny>;
type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
function register<S extends Shape>(server: ToolServer, name: string, description: string, inputSchema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>, toContent: (value: unknown) => ContentBlock[] = (value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]): void {
  server.registerTool(name, { description, inputSchema: z.object(inputSchema), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } } as never, (async (args: Record<string, unknown>) => {
    const started = Date.now();
    try {
      const content = toContent(await handler(args as z.infer<z.ZodObject<S>>));
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
