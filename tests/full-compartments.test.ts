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

interface FakeOptions { failOn?: (date: string) => boolean; onCarriages?: (date: string) => void; carGroups?: TrainRoute["carGroups"] }

function clientWith(fixture: string, options: FakeOptions | ((date: string) => boolean) = {}): RzdClient {
  const { failOn = () => false, onCarriages = () => {}, carGroups = [{ carType: "Compartment", availablePlaces: 4, raw: {} }] } = typeof options === "function" ? { failOn: options } as FakeOptions : options;
  let departureDate = "";
  const api = {
    async getTrainRoutes(input: { departureDate: string }): Promise<TrainRoute[]> {
      departureDate = input.departureDate.slice(0, 10);
      if (failOn(departureDate)) throw new Error("upstream unavailable");
      return [{ number: "002Э", departureTime: `${departureDate}T01:00:00`, availablePlaces: 4, carGroups, raw: {}, provider: "P1" }];
    },
    async getCarriages(): Promise<CarriageResult> {
      onCarriages(departureDate);
      const payload = await Bun.file(`${import.meta.dir}/fixtures/${fixture}.json`).json();
      const transport = { requestJson: async () => payload, close() {} } as unknown as RzdTransport;
      return new RzdApi(makeConfig(), transport).getCarriages("2000000", "2034130", "2026-09-01T01:00:00", "002Э", "P1");
    },
    close() {},
  } as unknown as RzdApi;
  return new RzdClient({}, api);
}

function day(offset: number): string { return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10); }
