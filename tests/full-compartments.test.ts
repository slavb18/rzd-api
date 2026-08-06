import { describe, expect, test } from "bun:test";
import { RzdApi } from "../src/api.ts";
import { RzdClient } from "../src/client.ts";
import type { CarriageResult, TrainRoute } from "../src/models.ts";
import type { RzdTransport } from "../src/transport.ts";
import { makeConfig } from "../src/config.ts";

describe("full compartment search", () => {
  test("reports a confirmed compartment with the date and train it came from", async () => {
    const client = clientWith("car-pricing-one-compartment");
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(30));
    expect(result.confirmed).toEqual([{ date: day(30), trainNumber: "002Э", departureTime: `${day(30)}T01:00:00`, arrivalTime: undefined, carNumber: "07", compartmentNumber: "1", places: [1, 2, 3, 4], placeLabels: ["1", "2", "3", "4"], serviceClass: "2К", minPrice: 21481, maxPrice: 21481, totalPrice: 85924 }]);
    expect(result.candidates).toEqual([]);
    client.close();
  });

  test("reports split places as a candidate and never as a confirmed compartment", async () => {
    const client = clientWith("car-pricing-split-compartments");
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(30));
    expect(result.confirmed).toEqual([]);
    expect(result.candidates).toEqual([{ date: day(30), trainNumber: "002Э", carNumber: "09", serviceClass: "2К", freePlaces: 4, largestCompartment: 2, reason: "places_not_in_one_compartment" }]);
    client.close();
  });

  test("stamps the moment of the check so stale availability is visible", async () => {
    const client = clientWith("car-pricing-one-compartment");
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(30));
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/);
    client.close();
  });

  test("does not open the carriages of a train whose compartments cannot hold the party", async () => {
    const fetched: string[] = [];
    const client = clientWith("car-pricing-one-compartment", { onCarriages: (date) => fetched.push(date), carGroups: [{ carType: "ReservedSeat", availablePlaces: 96, raw: {} }] });
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(30));
    expect(fetched).toEqual([]);
    expect(result.confirmed).toEqual([]);
    client.close();
  });

  test("stops at the request budget and names the dates it never checked", async () => {
    const client = clientWith("car-pricing-one-compartment");
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(32), { maxRequests: 2 });
    expect(result.truncated).toBe(true);
    expect(result.unchecked).toEqual([day(31), day(32)]);
    expect(result.requests).toBe(2);
    client.close();
  });

  test("counts the requests it spent when the whole range fits", async () => {
    const client = clientWith("car-pricing-one-compartment");
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(31));
    expect(result.unchecked).toEqual([]);
    expect(result.requests).toBe(4);
    client.close();
  });

  test("stops as soon as the asked-for number of options is found", async () => {
    const client = clientWith("car-pricing-one-compartment");
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(34), { maxResults: 2 });
    expect(result.confirmed.map((match) => match.date)).toEqual([day(30), day(31)]);
    expect(result.requests).toBe(4);
    expect(result.unchecked).toEqual([day(32), day(33), day(34)]);
    client.close();
  });

  test("returns the asked-for number of candidates and says how many it left out", async () => {
    const client = clientWith("car-pricing-split-compartments");
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(32), { maxResults: 2 });
    expect(result.candidates.map((candidate) => candidate.date)).toEqual([day(30), day(31)]);
    expect(result.omitted).toEqual({ confirmed: 0, candidates: 1 });
    client.close();
  });

  test("draws the compartment it found without being asked for a picture", async () => {
    const asked: unknown[] = [];
    const client = clientWith("car-pricing-one-compartment", { onSchemeImage: (...args) => asked.push(args) });
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(30));
    expect(result.image).toEqual({ data: "UE5H", mimeType: "image/png", url: "https://rzd-api.vercel.app/scheme/552/PcFirstStorey.png?free=1%2C2%2C3%2C4", carNumber: "07", compartmentNumber: "1" });
    expect(asked).toEqual([[552, "PcFirstStorey", { free: [1, 2, 3, 4] }]]);
    client.close();
  });

  test("leaves the picture out when it is turned off", async () => {
    const asked: unknown[] = [];
    const client = clientWith("car-pricing-one-compartment", { onSchemeImage: (...args) => asked.push(args) });
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(30), { image: false });
    expect(result.image).toBeUndefined();
    expect(asked).toEqual([]);
    client.close();
  });

  test("still answers when the drawing cannot be fetched", async () => {
    const client = clientWith("car-pricing-one-compartment", { schemeFails: true });
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(30));
    expect(result.confirmed).toHaveLength(1);
    expect(result.image).toBeUndefined();
    client.close();
  });

  test("comes back with what it has when it runs out of time", async () => {
    const client = clientWith("car-pricing-split-compartments", { delayMs: 30 });
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(40), { maxSeconds: 0.1 });
    expect(result.truncated).toBe(true);
    expect(result.unchecked.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeGreaterThan(0);
    client.close();
  });

  test("starts from today when the month it was given has already begun", async () => {
    const client = clientWith("car-pricing-one-compartment");
    const result = await client.searchFullCompartments("2000000", "2034130", day(-20), day(2));
    expect(result.dateFrom).toBe(day(0));
    expect(result.dateTo).toBe(day(2));
    client.close();
  });

  test("refuses a range that is entirely behind us", async () => {
    const client = clientWith("car-pricing-one-compartment");
    await expect(client.searchFullCompartments("2000000", "2034130", day(-20), day(-5))).rejects.toThrow("past");
    client.close();
  });

  test("rejects a range longer than 31 days before making a request", async () => {
    const client = clientWith("car-pricing-one-compartment");
    await expect(client.searchFullCompartments("2000000", "2034130", day(30), day(70))).rejects.toThrow("31 days");
    client.close();
  });

  test("records a failing date without aborting the remaining dates", async () => {
    const client = clientWith("car-pricing-one-compartment", (date) => date === day(30));
    const result = await client.searchFullCompartments("2000000", "2034130", day(30), day(31));
    expect(result.errors).toEqual([{ date: day(30), error: "upstream unavailable" }]);
    expect(result.confirmed.map((match) => match.date)).toEqual([day(31)]);
    client.close();
  });
});

interface FakeOptions { delayMs?: number; failOn?: (date: string) => boolean; onCarriages?: (date: string) => void; carGroups?: TrainRoute["carGroups"]; onSchemeImage?: (...args: unknown[]) => void; schemeFails?: boolean }

function clientWith(fixture: string, options: FakeOptions | ((date: string) => boolean) = {}): RzdClient {
  const { delayMs = 0, failOn = () => false, onCarriages = () => {}, carGroups = [{ carType: "Compartment", availablePlaces: 4, raw: {} }], onSchemeImage = () => {}, schemeFails = false } = typeof options === "function" ? { failOn: options } as FakeOptions : options;
  let departureDate = "";
  const api = {
    async getTrainRoutes(input: { departureDate: string }): Promise<TrainRoute[]> {
      departureDate = input.departureDate.slice(0, 10);
      if (failOn(departureDate)) throw new Error("upstream unavailable");
      return [{ number: "002Э", departureTime: `${departureDate}T01:00:00`, availablePlaces: 4, carGroups, raw: {}, provider: "P1" }];
    },
    async getCarriages(): Promise<CarriageResult> {
      onCarriages(departureDate);
      if (delayMs) await Bun.sleep(delayMs);
      const payload = await Bun.file(`${import.meta.dir}/fixtures/${fixture}.json`).json();
      const transport = { requestJson: async () => payload, close() {} } as unknown as RzdTransport;
      return new RzdApi(makeConfig(), transport).getCarriages("2000000", "2034130", "2026-09-01T01:00:00", "002Э", "P1");
    },
    async getCarScheme() {
      if (schemeFails) throw new Error("scheme unavailable");
      return { schemeId: 552, imageUrls: [{ kind: "PcFirstStorey", url: "https://ticket.rzd.ru/api/v1/carscheme/image/552/PcFirstStorey" }], raw: {} };
    },
    async getSchemeImage(...args: unknown[]) { onSchemeImage(...args); return { data: "UE5H", mimeType: "image/png" }; },
    close() {},
  } as unknown as RzdApi;
  return new RzdClient({}, api);
}

function day(offset: number): string { return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10); }
