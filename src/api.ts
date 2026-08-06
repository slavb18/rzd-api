import type { RzdConfig } from "./config.js";
import { RzdSchemaError, RzdValidationError } from "./errors.js";
import type { CarGroup, CarImagesResult, Carriage, CarriageResult, CarScheme, JsonObject, MinimalPricingResult, RouteStation, RouteStationsResult, SchemeImage, SchemeImageContent, Station, TrainAvailabilityResult, TrainRoute } from "./models.js";

export const schemeImageKinds = ["PcFirstStorey", "PcSecondStorey", "MobileFirstStoreyVert", "MobileSecondStoreyVert"] as const;
export type SchemeImageKind = (typeof schemeImageKinds)[number];
import { renderScheme, type Rasterizer, type SchemePlaces } from "./raster.js";
import { isObject, RzdTransport, type JsonPayload } from "./transport.js";

export class RzdApi {
  readonly baseUrl: string;
  readonly b2bBaseUrl: string;
  constructor(readonly config: RzdConfig, readonly transport = new RzdTransport(config), readonly rasterize: Rasterizer = renderScheme) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    const site = new URL(this.baseUrl).origin;
    this.b2bBaseUrl = (config.b2bBaseUrl ?? `${site}/apib2b/p`).replace(/\/$/, "");
  }

  async getTrainRoutes(input: { origin: string; destination: string; departureDate: string; adults: number; children: number }): Promise<TrainRoute[]> {
    const payload = await this.transport.requestJson("GET", `${this.baseUrl}/railway-service/prices/train-pricing`, { params: { service_provider: "B2B_RZD", getByLocalTime: true, carGrouping: "DontGroup", origin: input.origin, destination: input.destination, departureDate: input.departureDate, specialPlacesDemand: "StandardPlacesAndForDisabledPersons", carIssuingType: "Passenger", getTrainsFromSchedule: true, adultPassengersQuantity: input.adults, childrenPassengersQuantity: input.children, hasPlacesForLargeFamily: false } });
    return trainNodes(payload).map(parseTrain);
  }
  async findStations(query: string, transportType: string, groupResults: boolean): Promise<Station[]> {
    const payload = await this.transport.requestJson("GET", `${this.baseUrl}/suggests`, { params: { Query: query, TransportType: transportType, GroupResults: groupResults.toString(), RailwaySortPriority: true, SynonymOn: 1, Language: this.config.language } });
    const result = parseStationNodes(suggestionNodes(payload));
    return [...new Map(result.map((s) => [`${s.name}\0${s.code}`, s])).values()];
  }
  async getTrainAvailability(origin: string, destination: string, dateFrom: string, dateTo: string): Promise<TrainAvailabilityResult> {
    const root = objectPayload(await this.transport.requestJson("GET", `${this.baseUrl}/railway-service/train-availability`, { params: { from: dateFrom, to: dateTo, originStationCode: origin, destinationStationCode: destination } }), "train-availability");
    const items = objectList(root, "AvailabilityItems", "train-availability").map((node) => ({ date: requiredString(node, "Date", "train-availability item"), raw: node }));
    return { originCode: requiredString(root, "OriginCode", "train-availability"), destinationCode: requiredString(root, "DestinationCode", "train-availability"), items, raw: root };
  }
  async getMinimalPricing(origin: string, destination: string, dateFrom: string): Promise<MinimalPricingResult> {
    const root = objectPayload(await this.transport.requestJson("GET", `${this.baseUrl}/railway-service/train-minimal-pricing`, { params: { dateFrom, originCode: origin, destinationCode: destination } }), "train-minimal-pricing");
    const prices = objectList(root, "PriceByDepartureDates", "train-minimal-pricing").map((node) => {
      const carriers = node.Carriers;
      if (!Array.isArray(carriers) || !carriers.every(isObject)) throw new RzdSchemaError("Invalid Carriers field.");
      return { date: stringValue(node, "DepatureDate", "DepartureDate") ?? fail("A pricing item has no departure date."), minPrice: numberValue(node, "MinPrice"), disabledPlaceMinPrice: numberValue(node, "DisabledPlaceMinPrice"), carriers, raw: node };
    });
    return { originCode: requiredString(root, "OriginStationCode", "train-minimal-pricing"), destinationCode: requiredString(root, "DestinationStationCode", "train-minimal-pricing"), prices, raw: root };
  }
  async getCarriages(origin: string, destination: string, departureDate: string, trainNumber: string, provider: string): Promise<CarriageResult> {
    const root = objectPayload(await this.transport.requestJson("POST", `${this.b2bBaseUrl}/Railway/V1/Search/CarPricing`, { params: { service_provider: "B2B_RZD", isBonusPurchase: false }, body: { OriginCode: origin, DestinationCode: destination, Provider: provider, DepartureDate: departureDate, TrainNumber: trainNumber, SpecialPlacesDemand: "StandardPlacesAndForDisabledPersons", OnlyFpkBranded: false, HasPlacesForLargeFamily: false, CarIssuingType: "Passenger" } }), "carriage");
    const info = root.TrainInfo; if (!isObject(info)) throw new RzdSchemaError("The carriage response has no TrainInfo object.");
    const docs = root.AllowedDocumentTypes; if (!Array.isArray(docs) || !docs.every((v) => typeof v === "string")) throw new RzdSchemaError("Invalid AllowedDocumentTypes field.");
    return { cars: carNodes(root).map(parseCarriage), trainNumber: stringValue(info, "TrainNumber"), originCode: stringValue(root, "OriginCode"), destinationCode: stringValue(root, "DestinationCode"), departureTime: stringValue(info, "DepartureDateTime", "LocalDepartureDateTime"), routePolicy: stringValue(root, "RoutePolicy"), bookingSystem: stringValue(root, "BookingSystem"), allowedDocumentTypes: docs, originRetrievalDate: stringValue(root, "OriginRetrievalDate"), raw: root };
  }
  async getCarScheme(params: Record<string, string>): Promise<CarScheme> { const root = objectPayload(await this.transport.requestJson("GET", `${this.baseUrl}/railway-service/carscheme`, { params: metadataParams(params) }), "car scheme"); return parseCarScheme(root, this.config.schemeImageBaseUrl); }

  /** Bytes come through the configured endpoint so a deployment behind a private proxy can
   *  read them; only the public link built in parseCarScheme is ever handed to a user. */
  async getSchemeImage(schemeId: number, kind: SchemeImageKind, places: SchemePlaces = {}): Promise<SchemeImageContent> {
    if (!Number.isInteger(schemeId) || schemeId < 0) throw new RzdValidationError("schemeId must be a non-negative integer.");
    if (!schemeImageKinds.includes(kind)) throw new RzdValidationError(`Unsupported scheme image kind: ${String(kind)}`);
    const image = await this.transport.requestBytes(`${this.baseUrl}/carscheme/image/${schemeId}/${kind}`);
    const png = image.mimeType === "image/svg+xml" ? await this.rasterize(Buffer.from(image.data).toString("utf8"), places) : null;
    return png ? { data: Buffer.from(png).toString("base64"), mimeType: "image/png" } : { data: Buffer.from(image.data).toString("base64"), mimeType: image.mimeType };
  }
  async getCarImages(params: Record<string, string>): Promise<CarImagesResult> { const root = objectPayload(await this.transport.requestJson("GET", `${this.baseUrl}/railway-service/carimage/list`, { params: metadataParams(params) }), "car images"); return { schemeId: integerValue(root, "SchemeId"), carSubType: stringValue(root, "CarSubType"), images: objectList(root, "Images", "car images").map((node) => ({ imageId: integerValue(node, "RailwayCarImageId"), titleRu: stringValue(node, "TitleRu"), titleEn: stringValue(node, "TitleEn"), preview: stringValue(node, "Preview"), content: stringValue(node, "Content"), sequenceNumber: integerValue(node, "SequenceNumber"), raw: node })), raw: root }; }
  async getRouteStations(origin: string, destination: string, departureDate: string, trainNumber: string, provider: string): Promise<RouteStationsResult> {
    const root = objectPayload(await this.transport.requestJson("GET", `${this.b2bBaseUrl}/Railway/V1/Search/TrainRoute`, { params: { TrainNumber: trainNumber, Origin: origin, Destination: destination, DepartureDate: departureDate, Provider: provider, GetNewRoute: true, service_provider: "B2B_RZD" } }), "route stations");
    const routes = objectList(root, "Routes", "route stations"); if (!routes[0]) throw new RzdSchemaError("The route-stations response contains no routes.");
    return { trainNumber: stringValue(routes[0], "TrainNumber") ?? trainNumber, stations: routes.flatMap((route) => objectList(route, "RouteStops", "route stations")).map(parseRouteStation), raw: root, routeName: stringValue(routes[0], "Name"), originName: stringValue(routes[0], "OriginName"), destinationName: stringValue(routes[0], "DestinationName") };
  }
  close(): void { this.transport.close(); }
}

function trainNodes(payload: JsonPayload): JsonObject[] { let value: unknown = payload; if (isObject(value) && isObject(value.data)) value = value.data; if (isObject(value)) value = value.Trains ?? value.trains; if (!Array.isArray(value) || !value.every(isObject)) throw new RzdSchemaError("The train-pricing response has no supported trains list."); return value; }
function parseTrain(node: JsonObject): TrainRoute { const number = stringValue(node, "TrainNumber", "trainNumber"); const displayNumber = stringValue(node, "DisplayTrainNumber", "displayTrainNumber"); if (!number && !displayNumber) throw new RzdSchemaError("A train item does not contain a train number."); const rawGroups = node.CarGroups ?? node.carGroups; let groups: CarGroup[] = []; let availablePlaces: number | undefined; if (rawGroups !== undefined) { if (!Array.isArray(rawGroups) || !rawGroups.every(isObject)) throw new RzdSchemaError("Invalid CarGroups field."); groups = rawGroups.map((g) => ({ carType: stringValue(g, "CarType", "carType", "Type", "type"), minPrice: numberValue(g, "MinPrice", "minPrice", "Price", "price"), availablePlaces: available(g), raw: g })); const values = groups.map((g) => g.availablePlaces); availablePlaces = values.some((v) => v === undefined) ? undefined : values.reduce<number>((a, b) => a + (b ?? 0), 0); } let minPrice = numberValue(node, "MinPrice", "minPrice"); if (minPrice === undefined) { const values = groups.flatMap((g) => g.minPrice === undefined ? [] : [g.minPrice]); minPrice = values.length ? Math.min(...values) : undefined; } return { number: number ?? displayNumber!, displayNumber, originName: stringValue(node, "OriginStationName", "originStationName"), destinationName: stringValue(node, "DestinationStationName", "destinationStationName"), departureTime: stringValue(node, "DepartureDateTime", "departureDateTime", "LocalDepartureDateTime", "localDepartureDateTime"), arrivalTime: stringValue(node, "ArrivalDateTime", "arrivalDateTime", "LocalArrivalDateTime", "localArrivalDateTime"), minPrice, availablePlaces, carGroups: groups, raw: node, routeNumber: stringValue(node, "TrainNumberToGetRoute", "trainNumberToGetRoute"), originCode: stringValue(node, "OriginStationCode", "originStationCode"), destinationCode: stringValue(node, "DestinationStationCode", "destinationStationCode"), provider: stringValue(node, "Provider", "provider") }; }
function suggestionNodes(payload: JsonPayload): unknown[] { if (Array.isArray(payload)) return payload; for (const key of ["suggestions", "items", "data"]) if (Array.isArray(payload[key])) return payload[key]; const categoryKeys = ["city", "train", "suburban", "bus"]; if (categoryKeys.some((k) => k in payload)) return categoryKeys.flatMap((k) => { const value = payload[k]; if (value === undefined) return []; if (!Array.isArray(value)) throw new RzdSchemaError(`The station suggestion '${k}' field must be a list.`); return value; }); if (!Object.keys(payload).length) return []; throw new RzdSchemaError("Unsupported station suggestion response."); }
function parseStationNodes(nodes: unknown[]): Station[] { const out: Station[] = []; for (const node of nodes) { if (!isObject(node)) throw new RzdSchemaError("Invalid station node."); const code = stringValue(node, "ExpressCode", "expressCode", "code", "Code", "c"); const name = stringValue(node, "NameRu", "nameRu", "name", "Name", "n", "title"); if (code && name) out.push({ name, code, raw: node, nodeId: stringValue(node, "nodeId", "NodeId", "id", "Id"), nodeType: stringValue(node, "nodeType", "NodeType"), transportType: stringValue(node, "transportType", "TransportType"), region: stringValue(node, "region", "Region") }); else { const nested = ["stations", "items", "children", "Children"].flatMap((k) => Array.isArray(node[k]) ? node[k] as unknown[] : []); if (!nested.length) throw new RzdSchemaError("Unsupported station node."); out.push(...parseStationNodes(nested)); } } return out; }
function carNodes(root: JsonObject): JsonObject[] { const nested = [root, root.data, root.Data].filter(isObject); const value = nested.flatMap((v) => [v.cars, v.Cars]).find((v) => v !== undefined); if (!Array.isArray(value) || !value.every(isObject)) throw new RzdSchemaError("The carriage response has no supported cars list."); return value; }
function parseCarriage(node: JsonObject): Carriage { const services = node.Services ?? []; if (!Array.isArray(services) || !services.every((v) => typeof v === "string")) throw new RzdSchemaError("Invalid Services field."); return { number: stringValue(node, "CarNumber", "carNumber", "Number", "number"), carType: stringValue(node, "CarType", "carType", "Type", "type"), minPrice: numberValue(node, "MinPrice", "minPrice", "Price", "price"), availablePlaces: available(node), raw: node, maxPrice: numberValue(node, "MaxPrice"), serviceCost: numberValue(node, "ServiceCost"), carSubType: stringValue(node, "CarSubType"), carTypeName: stringValue(node, "CarTypeName"), serviceClass: stringValue(node, "ServiceClass"), serviceClassName: stringValue(node, "ServiceClassNameRu", "ServiceClassNameEn"), schemeId: integerValue(node, "RailwayCarSchemeId"), schemeName: stringValue(node, "CarSchemeName"), carrier: stringValue(node, "Carrier"), carrierDisplayName: stringValue(node, "CarrierDisplayName"), direction: stringValue(node, "CarDirection"), numeration: stringValue(node, "CarNumeration"), trainNumber: stringValue(node, "TrainNumber"), freePlaces: stringValue(node, "FreePlaces"), services, hasImages: booleanValue(node, "HasImages") }; }
function parseCarScheme(node: JsonObject, imageBaseUrl: string): CarScheme { return { schemeId: integerValue(node, "SchemeId"), carSubType: stringValue(node, "CarSubType"), startDate: stringValue(node, "StartDate"), endDate: stringValue(node, "EndDate"), trainNumber: stringValue(node, "TrainNumber"), carrier: stringValue(node, "Carrier"), carNumber: stringValue(node, "CarNumber"), serviceClass: stringValue(node, "ServiceClass"), firstStorey: stringValue(node, "PcSchemeFirstStorey"), secondStorey: stringValue(node, "PcSchemeSecondStorey"), mobileFirstStorey: stringValue(node, "MobileSchemeFirstVertStorey"), mobileSecondStorey: stringValue(node, "MobileSchemeSecondVertStorey"), direction: stringValue(node, "Direction"), imageUrls: schemeImages(node, imageBaseUrl), raw: node }; }
/** Paths come from the RZD response, so they are matched against the one shape the API uses
 *  ("/552/PcFirstStorey") and the resolved URL is required to stay on the configured public
 *  origin. A published link must never be able to point somewhere else. */
function schemeImages(node: JsonObject, baseUrl: string): SchemeImage[] {
  const base = baseUrl.replace(/\/$/, "");
  return ["PcSchemeFirstStorey", "PcSchemeSecondStorey", "MobileSchemeFirstVertStorey", "MobileSchemeSecondVertStorey"].flatMap((field) => {
    const path = stringValue(node, field);
    const match = path === undefined ? null : /^\/\d+\/([A-Za-z]+)$/.exec(path);
    const kind = match?.[1];
    if (!kind || !schemeImageKinds.includes(kind as SchemeImageKind)) return [];
    const url = new URL(`${base}${path}`);
    return url.origin === new URL(base).origin ? [{ kind, url: url.toString() }] : [];
  });
}
function parseRouteStation(node: JsonObject): RouteStation { return { name: stringValue(node, "StationName", "stationName", "Name", "name"), code: stringValue(node, "StationCode", "stationCode", "Code", "code"), arrivalTime: stringValue(node, "ArrivalDateTime", "arrivalDateTime", "ArrivalTime", "arrivalTime"), departureTime: stringValue(node, "DepartureDateTime", "departureDateTime", "DepartureTime", "departureTime"), distance: integerValue(node, "Distance", "distance"), raw: node, cityName: stringValue(node, "CityName"), localArrivalTime: stringValue(node, "LocalArrivalDateTime", "LocalArrivalTime"), localDepartureTime: stringValue(node, "LocalDepartureDateTime", "LocalDepartureTime"), stopDuration: numberValue(node, "StopDuration"), timeDescription: stringValue(node, "TimeDescription"), daysFromOrigin: integerValue(node, "DaysFromFormingStation"), timeZoneDifference: integerValue(node, "TimeZoneDifference"), actualMovement: booleanValue(node, "ActualMovement"), isCutawayStation: booleanValue(node, "IsCutawayStation") }; }
function metadataParams(p: Record<string, string>): Record<string, string> { return { CarSubType: p.carSubType!, CarNumber: p.carNumber!, ServiceClass: p.serviceClass!, Carrier: p.carrier!, TrainNumber: p.trainNumber!, DepartureDate: p.departureDate!, CarNumeration: p.carNumeration! }; }
function objectPayload(payload: JsonPayload, endpoint: string): JsonObject { if (!isObject(payload)) throw new RzdSchemaError(`The ${endpoint} response must be an object.`); return payload; }
function objectList(root: JsonObject, key: string, endpoint: string): JsonObject[] { const value = root[key]; if (!Array.isArray(value) || !value.every(isObject)) throw new RzdSchemaError(`The ${endpoint} response has no supported ${key} list.`); return value; }
function requiredString(node: JsonObject, key: string, endpoint: string): string { return stringValue(node, key) ?? fail(`The ${endpoint} response has no ${key} field.`); }
function stringValue(node: JsonObject, ...keys: string[]): string | undefined { for (const key of keys) if (node[key] !== undefined && node[key] !== null && node[key] !== "") return String(node[key]); return undefined; }
function numberValue(node: JsonObject, ...keys: string[]): number | undefined { for (const key of keys) { const value = node[key]; if (value === undefined || value === null || value === "" || typeof value === "boolean") continue; const parsed = Number(value); if (!Number.isFinite(parsed)) throw new RzdSchemaError(`Field ${key} must be numeric.`); return parsed; } return undefined; }
function integerValue(node: JsonObject, ...keys: string[]): number | undefined { const value = numberValue(node, ...keys); if (value !== undefined && !Number.isInteger(value)) throw new RzdSchemaError(`Field ${keys[0]} must be an integer.`); return value; }
function booleanValue(node: JsonObject, ...keys: string[]): boolean | undefined { for (const key of keys) if (node[key] !== undefined && node[key] !== null) { if (typeof node[key] !== "boolean") throw new RzdSchemaError(`Field ${key} must be a boolean.`); return node[key]; } return undefined; }
function available(node: JsonObject): number | undefined { for (const key of ["TotalPlaceQuantity", "totalPlaceQuantity", "PlaceQuantity", "placeQuantity", "FreePlaces", "freePlaces"]) { const value = Number(node[key]); if (node[key] !== undefined && node[key] !== "" && Number.isInteger(value)) return value; } const keys = ["LowerPlaceQuantity", "lowerPlaceQuantity", "UpperPlaceQuantity", "upperPlaceQuantity", "SideLowerPlaceQuantity", "sideLowerPlaceQuantity", "SideUpperPlaceQuantity", "sideUpperPlaceQuantity"].filter((k) => k in node); if (keys.length) { const values = keys.map((k) => Number(node[k])); if (values.every(Number.isInteger)) return values.reduce((a, b) => a + b, 0); } return undefined; }
function fail(message: string): never { throw new RzdSchemaError(message); }
