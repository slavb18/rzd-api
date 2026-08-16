import { describe, expect, test } from "bun:test";
import { RzdApi } from "../src/api.ts";
import { makeConfig } from "../src/config.ts";
import type { RzdTransport } from "../src/transport.ts";

/** ticket.rzd.ru answers this endpoint with every field null for directions it publishes no
 *  prices for. That is an empty answer, not a broken one, and it must not be reported as a
 *  schema change - the whole point of the schema errors is that they mean the API moved. */
describe("minimal pricing", () => {
  test("reports no prices when the endpoint answers with nulls", async () => {
    const result = await apiReturning({ OriginStationCode: null, DestinationStationCode: null, PriceByDepartureDates: null })
      .getMinimalPricing("2000000", "2004000", "2026-08-20");
    expect(result.prices).toEqual([]);
  });

  test("names the direction it was asked about when the answer does not", async () => {
    const result = await apiReturning({ OriginStationCode: null, DestinationStationCode: null, PriceByDepartureDates: null })
      .getMinimalPricing("2000000", "2004000", "2026-08-20");
    expect([result.originCode, result.destinationCode]).toEqual(["2000000", "2004000"]);
  });

  test("still refuses a response whose price list has gone missing altogether", async () => {
    await expect(apiReturning({ OriginStationCode: "2000000", DestinationStationCode: "2004000" })
      .getMinimalPricing("2000000", "2004000", "2026-08-20")).rejects.toThrow("PriceByDepartureDates");
  });

  test("still refuses a price list that is not a list", async () => {
    await expect(apiReturning({ PriceByDepartureDates: "soon" })
      .getMinimalPricing("2000000", "2004000", "2026-08-20")).rejects.toThrow("PriceByDepartureDates");
  });

  test("parses the prices when the endpoint does publish them", async () => {
    const result = await apiReturning({ OriginStationCode: "2000000", DestinationStationCode: "2004000", PriceByDepartureDates: [{ DepatureDate: "2026-08-20", MinPrice: 3500, Carriers: [] }] })
      .getMinimalPricing("2000000", "2004000", "2026-08-20");
    expect(result.prices.map((price) => [price.date, price.minPrice])).toEqual([["2026-08-20", 3500]]);
  });
});

function apiReturning(payload: unknown): RzdApi {
  const transport = { requestJson: async () => payload, close() {} } as unknown as RzdTransport;
  return new RzdApi(makeConfig(), transport);
}
