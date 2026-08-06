import { schemeFont } from "./scheme-font.js";

export interface SchemePlaces { free?: number[]; selected?: number[] }
export type Rasterizer = (svg: string, places?: SchemePlaces) => Promise<Uint8Array | null>;

/** The drawing is a template: every berth is near-white with white numbers on top, because the
 *  site recolours it per availability. Rendered untouched it is unreadable, so the two states
 *  the site itself shows are filled here: blue for free places, red for the ones being offered. */
const fills = { free: { fill: "#4A90E2", stroke: "#2F6FBF" }, selected: { fill: "#E21A1A", stroke: "#B31414" } };

/** The place numbers are drawn white, legible only once the site has filled the berth with a
 *  colour. Darkening them keeps every number readable, painted or not. */
const numberFill = ".st7{fill:#2B3038}";

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
  return svg.replace("</svg>", `<style>${numberFill}${rules.join("")}</style></svg>`);
}

async function loadRenderer(): Promise<Renderer | null> {
  try {
    const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
    await initWasm(await Bun.file(new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))).arrayBuffer());
    const fontBuffers = [Uint8Array.from(atob(schemeFont), (character) => character.charCodeAt(0))];
    return (svg) => new Resvg(svg, {
      fitTo: { mode: "width", value: outputWidth },
      background: "white",
      font: { fontBuffers, defaultFontFamily: "DejaVu Sans", loadSystemFonts: false },
    }).render().asPng();
  } catch { return null; }
}
