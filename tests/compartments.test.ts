import { describe, expect, test } from "bun:test";
import { RzdApi } from "../src/api.ts";
import { findFullCompartments } from "../src/compartments.ts";
import { makeConfig } from "../src/config.ts";
import type { CarriageResult, JsonObject } from "../src/models.ts";
import type { RzdTransport } from "../src/transport.ts";

const fixtures = ["car-pricing-one-compartment", "car-pricing-split-compartments", "car-pricing-truncated-compartments"] as const;

describe("full compartment detection", () => {
  test("confirms a compartment when one compartment holds all four free places", async () => {
    const scan = findFullCompartments(await carriages("car-pricing-one-compartment"));
    expect(scan.confirmed).toEqual([{ carNumber: "07", compartmentNumber: "1", places: [1, 2, 3, 4], serviceClass: "2К", minPrice: 21481, maxPrice: 21481, totalPrice: 85924 }]);
    expect(scan.candidates).toEqual([]);
  });

  test("keeps four free places split across two compartments a candidate", async () => {
    const scan = findFullCompartments(await carriages("car-pricing-split-compartments"));
    expect(scan.confirmed).toEqual([]);
    expect(scan.candidates).toEqual([{ carNumber: "09", serviceClass: "2К", freePlaces: 4, largestCompartment: 2, reason: "places_not_in_one_compartment" }]);
  });

  test("keeps a carriage without a compartment breakdown a candidate", async () => {
    const scan = findFullCompartments(await carriages("car-pricing-truncated-compartments"));
    expect(scan.confirmed).toEqual([]);
    expect(scan.candidates.map((candidate) => [candidate.carNumber, candidate.reason])).toEqual([["07", "compartment_layout_missing"], ["08", "compartment_layout_missing"]]);
  });

  test("never confirms a compartment the raw response does not list with four free places", async () => {
    for (const fixture of fixtures) {
      const result = await carriages(fixture);
      for (const match of findFullCompartments(result).confirmed) {
        const car = result.cars.find((value) => value.number === match.carNumber);
        const groups = car?.raw.FreePlacesByCompartments;
        expect(Array.isArray(groups)).toBe(true);
        const group = (groups as JsonObject[]).find((value) => String(value.CompartmentNumber) === match.compartmentNumber);
        expect(String(group?.Places ?? "").split(",").filter((place) => place.trim())).toHaveLength(4);
      }
    }
  });
});

async function carriages(fixture: string): Promise<CarriageResult> {
  const payload = await Bun.file(`${import.meta.dir}/fixtures/${fixture}.json`).json();
  const transport = { requestJson: async () => payload, close() {} } as unknown as RzdTransport;
  return new RzdApi(makeConfig(), transport).getCarriages("2000000", "2034130", "2026-09-01T01:00:00", "002Э", "P1");
}
