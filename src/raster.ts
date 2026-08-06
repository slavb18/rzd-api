import { logEvent } from "./log.js";
import { schemeFont } from "./scheme-font.js";
import { schemeWasm } from "./scheme-wasm.js";

export interface SchemePlaces { free?: number[]; selected?: number[] }
export type Rasterizer = (svg: string, places?: SchemePlaces) => Promise<Uint8Array | null>;

/** The drawing is a template: every berth is near-white with white numbers on top, because the
 *  site recolours it per availability. Rendered untouched it is unreadable, so the two states
 *  the site itself shows are filled here: blue for free places, red for the ones being offered. */
const fills = { free: { fill: "#4A90E2", stroke: "#2F6FBF" }, selected: { fill: "#E21A1A", stroke: "#B31414" } };

/** The numbers are drawn white, legible only once the site has filled the berth with a colour.
 *  Darkening them makes the untouched berths readable; the painted ones get their white back,
 *  matched by the number the text node carries. */
const numberFill = ".st7{fill:#2B3038}";
const paintedNumberFill = "#FFFFFF";

/** Renders the whole carriage: cropping to a compartment would force resvg to rasterise the
 *  full car at the zoom factor first, which costs seconds, and it hides the neighbouring
 *  compartments the reader needs for context. */
const outputWidth = 2000;

let renderer: Promise<Renderer | null> | undefined;
type Renderer = (svg: string) => Uint8Array;

/** Models accept png, jpeg, gif and webp and never SVG: handed an SVG a client can only save
 *  it to a file. Returns null when the rasterizer cannot start, so the caller can fall back. */
export const renderScheme: Rasterizer = async (svg, places = {}) => {
  const render = await (renderer ??= loadRenderer());
  if (!render) return null;
  try { return render(paint(svg, places)); } catch { return null; }
};

export function paint(svg: string, places: SchemePlaces): string {
  const rules = (Object.keys(fills) as (keyof typeof fills)[]).flatMap((state) => {
    const seats = places[state] ?? [];
    return seats.length ? [`${seats.map((place) => `#Seat${place}`).join(",")}{fill:${fills[state].fill};stroke:${fills[state].stroke}}`] : [];
  });
  const painted = new Set([...(places.free ?? []), ...(places.selected ?? [])]);
  const drawing = painted.size === 0 ? svg : svg.replace(/<text([^>]*)>(\d+)<\/text>/g,
    (node, attributes: string, number: string) => painted.has(Number(number)) ? `<text${attributes} style="fill:${paintedNumberFill}">${number}</text>` : node);
  return drawing.replace("</svg>", `<style>${numberFill}${rules.join("")}</style></svg>`);
}

async function loadRenderer(): Promise<Renderer | null> {
  try {
    const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
    const unpacked = Bun.gunzipSync(decode(schemeWasm));
    const wasm = new Uint8Array(unpacked.byteLength);
    wasm.set(unpacked);
    await initWasm(wasm);
    const fontBuffers = [decode(schemeFont)];
    return (svg) => new Resvg(svg, {
      fitTo: { mode: "width", value: outputWidth },
      background: "white",
      font: { fontBuffers, defaultFontFamily: "DejaVu Sans", loadSystemFonts: false },
    }).render().asPng();
  } catch (error) {
    // Without this the drawing silently degrades to SVG, which no model can look at, and
    // nothing anywhere says why.
    logEvent({ rasterizer: "unavailable", error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    return null;
  }
}

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
