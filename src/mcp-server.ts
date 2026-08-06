import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import { schemeImageKinds } from "./api.js";
import { RzdClient } from "./client.js";
import { configFromEnvironment } from "./config.js";

const station = z.string().describe("Station name or numeric station code");
const date = z.string().describe("Date in DD.MM.YYYY, YYYY-MM-DD, or ISO format");

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "RZD API", version: "4.0.0" }, {
    instructions: "Use these read-only tools to search the unofficial ticket.rzd.ru API. Dates must not be in the past. Search results and internal RZD response schemas can change without notice.",
  });

  registerMcpTools(server);
  return server;
}

type ToolServer = Pick<McpServer, "registerTool">;

export function registerMcpTools(server: ToolServer): void {
  register(server, "search_tickets", "Search direct RZD routes by station name/code and departure date.", {
    from_station: station, to_station: station, departure_date: date, return_date: date.optional(), adults: z.number().int().min(1).default(1), children: z.number().int().min(0).default(0), only_with_seats: z.boolean().default(true), include_transfers: z.boolean().default(false), transport_type: z.enum(["all", "trains", "suburban"]).default("all"),
  }, async (args) => usingClient((client) => client.searchTickets(args.from_station, args.to_station, args.departure_date, { returnDate: args.return_date, adults: args.adults, children: args.children, onlyWithSeats: args.only_with_seats, includeTransfers: args.include_transfers, transportType: args.transport_type })));
  register(server, "search_full_compartments", "Find compartments whose places are all free, over an inclusive date range of at most 31 days. A match is confirmed only when the carriage response lists the requested places inside one compartment; carriages with enough free places but no such confirmation are returned as candidates. Dates the scan did not reach come back in unchecked - they were not searched, they are not empty.", {
    from_station: station, to_station: station, date_from: date, date_to: date, places: z.number().int().min(2).default(4), max_results: z.number().int().min(1).max(500).default(3).describe("How many options to return; the scan stops once this many compartments are confirmed"), max_requests: z.number().int().min(1).max(1000).default(150).describe("Upstream request budget for the whole scan; dates left over are returned in unchecked"),
  }, async (args) => usingClient((client) => client.searchFullCompartments(args.from_station, args.to_station, args.date_from, args.date_to, { places: args.places, maxResults: args.max_results, maxRequests: args.max_requests })));
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
  }), (value) => {
    const image = (value as { image?: { data: string; mimeType: string } }).image;
    const { image: _omitted, ...scheme } = value as Record<string, unknown>;
    return [{ type: "text" as const, text: JSON.stringify(scheme, null, 2) }, ...(image ? [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] : [])];
  });
  register(server, "get_car_images", "Get carriage image metadata.", metadata, async (args) => usingClient((client) => client.getCarImages(args.departure_date, args.departure_time, args.train_number, args.car_number, args.car_sub_type, args.service_class, args.carrier, args.car_numeration)));
  register(server, "get_route_stations", "Get all stations for a train and direction.", { from_station: station, to_station: station, departure_date: date, departure_time: z.string(), train_number: z.string(), provider: z.string().default("P1") }, async (args) => usingClient((client) => client.getRouteStations(args.from_station, args.to_station, args.departure_date, args.departure_time, args.train_number, args.provider)));
}

type Shape = Record<string, z.ZodTypeAny>;
type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
function register<S extends Shape>(server: ToolServer, name: string, description: string, inputSchema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>, toContent: (value: unknown) => ContentBlock[] = (value) => [{ type: "text", text: JSON.stringify(value, null, 2) }]): void {
  server.registerTool(name, { description, inputSchema: z.object(inputSchema), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } } as never, (async (args: Record<string, unknown>) => {
    try { return { content: toContent(await handler(args as z.infer<z.ZodObject<S>>)) }; }
    catch (error) { return { content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true }; }
  }) as never);
}

async function usingClient<T>(callback: (client: RzdClient) => Promise<T>): Promise<T> { const client = new RzdClient(configFromEnvironment()); try { return await callback(client); } finally { client.close(); } }
