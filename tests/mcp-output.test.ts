import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import { describeDrawing, registerMcpTools, serverInstructions, withoutRaw } from "../src/mcp-server.ts";
import { schemeImageUrl } from "../src/log.ts";

/** Every parsed model carries the upstream payload it came from in `raw`. That is a useful
 *  escape hatch when the API moves, and ruinous as a default: on a Moscow - St Petersburg
 *  search it was 97% of the answer, and the tool result was thrown away by the client for
 *  being too large before the model ever saw a train. */
describe("upstream payload in tool results", () => {
  test("drops the duplicate at every depth", () => {
    const value = { number: "022А", raw: { TrainNumber: "022А" }, carGroups: [{ carType: "Compartment", raw: { CarType: "Compartment" } }] };
    expect(withoutRaw(value)).toEqual({ number: "022А", carGroups: [{ carType: "Compartment" }] });
  });

  test("keeps a field whose name merely starts with raw", () => {
    expect(withoutRaw({ rawPlaces: [1, 2], raw: {} })).toEqual({ rawPlaces: [1, 2] });
  });

  test("leaves the value it was given untouched", () => {
    const value = { number: "022А", raw: { TrainNumber: "022А" } };
    withoutRaw(value);
    expect(value.raw).toEqual({ TrainNumber: "022А" });
  });

  test("offers the duplicate as an opt-in on every tool whose answer carries one", () => {
    const shapes = registeredTools();
    const carriers = ["search_tickets", "get_carriages", "find_stations", "get_train_availability", "get_minimal_prices", "get_car_scheme", "get_car_images", "get_route_stations"];
    expect(carriers.filter((name) => !("include_raw" in shapes.get(name)!.schema))).toEqual([]);
  });

  test("does not offer it where there is no upstream payload to return", () => {
    expect("include_raw" in registeredTools().get("search_full_compartments")!.schema).toBe(false);
  });

  test("keeps the duplicate out of a carriage answer unless it is asked for", async () => {
    const text = await carriageAnswer({});
    expect(text).not.toContain('"raw"');
    expect(JSON.parse(text).cars).toHaveLength(1);
  });

  test("returns the duplicate when the caller does ask for it", async () => {
    const text = await carriageAnswer({ include_raw: true });
    expect(JSON.parse(text).cars[0].raw.CarNumber).toBe("07");
  });
});

/** The sentence next to the drawing is the only thing a text-only client sees about it, so it
 *  has to say what the picture shows. It used to print a literal "вагон ?, купе ?" whenever the
 *  caller had not come through the compartment search. */
describe("describing the drawing", () => {
  test("names the carriage and the compartment when both are known", () => {
    expect(describeDrawing({ carNumber: "01", compartmentNumber: "4" })).toEqual({ shows: "вагон 01, купе 4, свободные места залиты синим", name: "carriage-01-compartment-4.png" });
  });

  test("names the carriage alone when the compartment is not known", () => {
    expect(describeDrawing({ carNumber: "02" })).toEqual({ shows: "вагон 02, свободные места залиты синим", name: "carriage-02.png" });
  });

  test("says only what it knows when neither is known", () => {
    expect(describeDrawing({})).toEqual({ shows: "свободные места залиты синим", name: "carriage.png" });
  });

  /** ChatGPT hands a connector's answer to the model as a JSON string: the image block never
   *  reaches it and the resource_link does not either, so the only picture the reader can get
   *  is one the model writes into its own reply. Handing over the finished markdown is what
   *  makes that happen; a bare URL sat in the answer and was not shown. */
  test("hands over a ready markdown image for a client that renders nothing itself", () => {
    expect(describeDrawing({ carNumber: "01", compartmentNumber: "4", url: "https://rzd-api.example/scheme/359/PcFirstStorey.png?free=13" }).markdown)
      .toBe("![вагон 01, купе 4, свободные места залиты синим](https://rzd-api.example/scheme/359/PcFirstStorey.png?free=13)");
  });

  test("offers no markdown when there is no link to put in it", () => {
    expect(describeDrawing({ carNumber: "01" }).markdown).toBeUndefined();
  });
});

/** An image block is not a picture in every client: the ones this server actually talks to
 *  pass text through and drop the rest, and then a drawing that was fetched, painted and
 *  attached is simply never seen. The link is what survives that, and get_car_scheme was
 *  handing back the block alone. */
describe("the link to the drawing", () => {
  test("carries the berths the picture paints, selected ones as well as free", () => {
    expect(schemeImageUrl("https://rzd-api.example", 552, "PcFirstStorey", [18, 20], [3])).toBe("https://rzd-api.example/scheme/552/PcFirstStorey.png?free=18%2C20&selected=3");
  });

  test("comes back from get_car_scheme, not only from the compartment search", async () => {
    const blocks = await schemeBlocks();
    expect(blocks.filter((block) => block.type === "resource_link").map((block) => block.uri)).toEqual(["https://rzd-api.example/scheme/552/PcFirstStorey.png?free=18%2C20"]);
  });

  test("is named in the text too, for a client that shows neither picture nor link", async () => {
    const blocks = await schemeBlocks();
    expect(JSON.parse(blocks.find((block) => block.type === "text")!.text!).schemeImageUrl).toBe("https://rzd-api.example/scheme/552/PcFirstStorey.png?free=18%2C20");
  });

  test("still arrives as a picture for the clients that can show one", async () => {
    expect((await schemeBlocks()).map((block) => block.type)).toEqual(["text", "image", "resource_link"]);
  });

  test("reaches the text as markdown, the one form ChatGPT can put in front of a reader", async () => {
    const blocks = await schemeBlocks();
    expect(JSON.parse(blocks.find((block) => block.type === "text")!.text!).schemeImageMarkdown)
      .toBe("![вагон 02, свободные места залиты синим](https://rzd-api.example/scheme/552/PcFirstStorey.png?free=18%2C20)");
  });

  test("is something the instructions tell the client to actually show", () => {
    expect(serverInstructions).toContain("schemeImageMarkdown");
  });
});

type Registered = { schema: Record<string, z.ZodTypeAny>; call: (args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string; uri?: string }[] }> };

function registeredTools(): Map<string, Registered> {
  const tools = new Map<string, Registered>();
  registerMcpTools({
    registerTool(name: string, config: { inputSchema: z.ZodObject<Record<string, z.ZodTypeAny>> }, call: Registered["call"]) { tools.set(name, { schema: config.inputSchema.shape, call }); },
  } as never);
  return tools;
}

/** Serves the carriage fixture where the upstream would be, so the answer travels the whole
 *  way through the registered tool rather than through a stand-in for it. */
async function carriageAnswer(extra: Record<string, unknown>): Promise<string> {
  const payload = await Bun.file(`${import.meta.dir}/fixtures/car-pricing-one-compartment.json`).json();
  const upstream = Bun.serve({ port: 0, fetch: () => Response.json(payload) });
  const previous = process.env.RZD_B2B_BASE_URL;
  process.env.RZD_B2B_BASE_URL = `http://localhost:${upstream.port}`;
  try {
    const tool = registeredTools().get("get_carriages")!;
    const args = z.object(tool.schema).parse({ from_station: "2000000", to_station: "2034130", departure_date: inDays(30), departure_time: "01:00", train_number: "002Э", ...extra });
    const result = await tool.call(args as Record<string, unknown>);
    return result.content[0]!.text!;
  } finally {
    await upstream.stop(true);
    if (previous === undefined) delete process.env.RZD_B2B_BASE_URL; else process.env.RZD_B2B_BASE_URL = previous;
  }
}

/** Stands in for both upstream calls the tool makes - the scheme metadata and the drawing
 *  itself - so the answer is assembled by the real handler. */
async function schemeBlocks(): Promise<{ type: string; text?: string; uri?: string }[]> {
  const scheme = await Bun.file(`${import.meta.dir}/fixtures/car-scheme.json`).json();
  const upstream = Bun.serve({
    port: 0,
    fetch: (request) => new URL(request.url).pathname.includes("/carscheme/image/")
      ? new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } })
      : Response.json(scheme),
  });
  const previous = { base: process.env.RZD_BASE_URL, published: process.env.RZD_PUBLIC_BASE_URL };
  process.env.RZD_BASE_URL = `http://localhost:${upstream.port}`;
  process.env.RZD_PUBLIC_BASE_URL = "https://rzd-api.example";
  try {
    const tool = registeredTools().get("get_car_scheme")!;
    const args = z.object(tool.schema).parse({ departure_date: inDays(30), departure_time: "00:25", train_number: "022А", car_number: "02", car_sub_type: "66К", service_class: "2Ф", carrier: "ТВЕРСК", car_numeration: "FromTail", include_image: true, free_places: [18, 20] });
    return (await tool.call(args as Record<string, unknown>)).content;
  } finally {
    await upstream.stop(true);
    for (const [key, value] of [["RZD_BASE_URL", previous.base], ["RZD_PUBLIC_BASE_URL", previous.published]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function inDays(offset: number): string { return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10); }
