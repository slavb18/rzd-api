import { describe, expect, test } from "bun:test";
import { RzdApi } from "../src/api.ts";
import { makeConfig } from "../src/config.ts";
import { paint } from "../src/raster.ts";
import type { RzdTransport } from "../src/transport.ts";

const privateBase = "https://proxy.internal.example/secret-prefix/api/v1";

describe("carriage scheme images", () => {
  test("publishes scheme image URLs on the public host", async () => {
    const scheme = await schemeFrom(privateBase);
    expect(scheme.imageUrls).toEqual([
      { kind: "PcFirstStorey", url: "https://ticket.rzd.ru/api/v1/carscheme/image/552/PcFirstStorey" },
      { kind: "MobileFirstStoreyVert", url: "https://ticket.rzd.ru/api/v1/carscheme/image/552/MobileFirstStoreyVert" },
    ]);
  });

  test("never leaks the configured endpoint into a published URL", async () => {
    const scheme = await schemeFrom(privateBase);
    for (const image of scheme.imageUrls) {
      expect(image.url).not.toContain("proxy.internal.example");
      expect(image.url).not.toContain("secret-prefix");
    }
  });

  test("drops a scheme path that would move the link off the public host", async () => {
    const payload = { SchemeId: 552, PcSchemeFirstStorey: "//evil.example/PcFirstStorey", MobileSchemeFirstVertStorey: "https://evil.example/MobileFirstStoreyVert" };
    const transport = { requestJson: async () => payload, close() {} } as unknown as RzdTransport;
    const scheme = await new RzdApi(makeConfig({ baseUrl: privateBase }), transport).getCarScheme({ carSubType: "66К", carNumber: "12", serviceClass: "2Ф", carrier: "ТВЕРСК", trainNumber: "022А", departureDate: "2026-08-07T00:25:00", carNumeration: "FromTail" });
    expect(scheme.imageUrls).toEqual([]);
  });

  test("fetches the image bytes through the configured endpoint, not the public host", async () => {
    const requested: string[] = [];
    const api = new RzdApi(makeConfig({ baseUrl: privateBase }), transportSpy(requested));
    const image = await api.getSchemeImage(552, "PcFirstStorey");
    expect(requested).toEqual([`${privateBase}/carscheme/image/552/PcFirstStorey`]);
    expect(image.mimeType).toBe("image/svg+xml");
    expect(image.data).toBe(Buffer.from("<svg/>").toString("base64"));
  });

  test("renders the drawing as PNG, the format clients can actually display", async () => {
    const api = new RzdApi(makeConfig({ baseUrl: privateBase }), svgTransport("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><text x='2' y='14'>12</text></svg>"));
    const image = await api.getSchemeImage(552, "PcFirstStorey");
    expect(image.mimeType).toBe("image/png");
    expect(Buffer.from(image.data, "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  test("falls back to the original drawing when the rasterizer cannot start", async () => {
    const api = new RzdApi(makeConfig({ baseUrl: privateBase }), svgTransport("<svg/>"), async () => null);
    const image = await api.getSchemeImage(552, "PcFirstStorey");
    expect(image.mimeType).toBe("image/svg+xml");
    expect(Buffer.from(image.data, "base64").toString()).toBe("<svg/>");
  });

  test("fills free places blue and booked places red, as the site does", async () => {
    const painted = paint("<svg><path id=\"Seat33\"/></svg>", { free: [33, 34], selected: [10] });
    expect(painted).toContain("#Seat33,#Seat34{fill:#4A90E2");
    expect(painted).toContain("#Seat10{fill:#E21A1A");
  });

  test("darkens the place numbers even when no places are painted", async () => {
    const painted = paint("<svg><path id=\"Seat1\"/></svg>", {});
    expect(painted).toContain(".st7{fill:#2B3038}");
    expect(painted).not.toContain("#Seat1{");
  });

  test("rejects a scheme image kind the API does not define", async () => {
    const api = new RzdApi(makeConfig({ baseUrl: privateBase }), transportSpy([]));
    await expect(api.getSchemeImage(552, "../../secret" as never)).rejects.toThrow("kind");
  });
});

async function schemeFrom(baseUrl: string) {
  const payload = await Bun.file(`${import.meta.dir}/fixtures/car-scheme.json`).json();
  const transport = { requestJson: async () => payload, close() {} } as unknown as RzdTransport;
  return new RzdApi(makeConfig({ baseUrl }), transport).getCarScheme({ carSubType: "66К", carNumber: "12", serviceClass: "2Ф", carrier: "ТВЕРСК", trainNumber: "022А", departureDate: "2026-08-07T00:25:00", carNumeration: "FromTail" });
}

function svgTransport(svg: string): RzdTransport {
  return { async requestBytes() { return { data: new Uint8Array(Buffer.from(svg)), mimeType: "image/svg+xml" }; }, close() {} } as unknown as RzdTransport;
}

function transportSpy(requested: string[]): RzdTransport {
  return { async requestBytes(url: string) { requested.push(url); return { data: new Uint8Array(Buffer.from("<svg/>")), mimeType: "image/svg+xml" }; }, close() {} } as unknown as RzdTransport;
}
