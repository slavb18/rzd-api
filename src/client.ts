import { RzdApi, type SchemeImageKind } from "./api.js";
import type { SchemePlaces } from "./raster.js";
import { findFullCompartments, type FullCompartmentCandidate, type FullCompartmentMatch, type FullCompartmentSearch, type SearchImage } from "./compartments.js";
import { makeConfig, type RzdConfig } from "./config.js";
import { schemeImageUrl } from "./log.js";
import { RzdAmbiguousStationError, RzdSchemaError, RzdStationNotFoundError, RzdValidationError } from "./errors.js";
import type { Carriage, CarImagesResult, CarriageResult, CarScheme, SchemeImageContent, RoundTripResult, RouteStationsResult, Station, TrainAvailabilityResult, TrainRoute, MinimalPricingResult } from "./models.js";

type DateInput = string | Date;
type CacheEntry = { at: number; stations: Station[] };

export class RzdClient {
  readonly config: RzdConfig;
  readonly api: RzdApi;
  #cache = new Map<string, CacheEntry>();
  #closed = false;
  constructor(config: Partial<RzdConfig> = {}, api?: RzdApi) { this.config = makeConfig(config); this.api = api ?? new RzdApi(this.config); }

  async searchTickets(fromStation: string | number, toStation: string | number, departureDate: DateInput, options: { returnDate?: DateInput; adults?: number; children?: number; onlyWithSeats?: boolean; includeTransfers?: boolean; transportType?: "all" | "trains" | "suburban" } = {}): Promise<TrainRoute[] | RoundTripResult> {
    this.#ensureOpen();
    const { adults = 1, children = 0, onlyWithSeats = true, includeTransfers = false, transportType = "all" } = options;
    if (includeTransfers) throw new RzdValidationError("Transfer routes are not supported by the ticket.rzd.ru v1 pricing endpoint.");
    if (transportType !== "all") throw new RzdValidationError("Transport-type filtering is not supported by the ticket.rzd.ru v1 pricing endpoint.");
    if (!Number.isInteger(adults) || adults < 1) throw new RzdValidationError("adults must be an integer greater than zero.");
    if (!Number.isInteger(children) || children < 0) throw new RzdValidationError("children must be a non-negative integer.");
    const departure = parseDateTime(departureDate, "departureDate");
    const returning = options.returnDate === undefined ? undefined : parseDateTime(options.returnDate, "returnDate");
    if (returning && returning < departure) throw new RzdValidationError("returnDate must not be earlier than departureDate.");
    const [origin, destination] = await this.#resolveDirection(fromStation, toStation);
    const forward = filterRoutes(await this.api.getTrainRoutes({ origin, destination, departureDate: formatDateTime(departure), adults, children }), onlyWithSeats);
    if (!returning) return forward;
    const back = filterRoutes(await this.api.getTrainRoutes({ origin: destination, destination: origin, departureDate: formatDateTime(returning), adults, children }), onlyWithSeats);
    return { forward, back, raw: { forward: forward.map((r) => r.raw), back: back.map((r) => r.raw) } };
  }

  async findStations(query: string, options: { transportType?: string; groupResults?: boolean } = {}): Promise<Station[]> {
    this.#ensureOpen(); const normalized = String(query).trim(); if (normalized.length < 2) throw new RzdValidationError("Station query must contain at least two characters.");
    const transportType = options.transportType ?? "rail,suburban"; const groupResults = options.groupResults ?? true; if (!transportType.trim()) throw new RzdValidationError("transportType must not be empty.");
    const key = `${normalized.toLocaleLowerCase("ru")}\0${transportType}\0${groupResults}`; const cached = this.#cache.get(key); const now = Date.now();
    if (cached && now - cached.at <= this.config.stationCacheTtlMs) { this.#cache.delete(key); this.#cache.set(key, cached); return [...cached.stations]; }
    this.#cache.delete(key); const stations = await this.api.findStations(normalized, transportType, groupResults);
    if (this.config.stationCacheSize && this.config.stationCacheTtlMs) { this.#cache.set(key, { at: now, stations: [...stations] }); while (this.#cache.size > this.config.stationCacheSize) this.#cache.delete(this.#cache.keys().next().value!); }
    return stations;
  }

  async resolveStationCode(station: string | number): Promise<string> {
    this.#ensureOpen(); const value = String(station).trim(); if (!value) throw new RzdValidationError("Station name or code must not be empty."); if (/^\d+$/.test(value)) return value;
    const matches = await this.findStations(value); if (!matches.length) throw new RzdStationNotFoundError(value); const folded = value.toLocaleLowerCase("ru");
    for (const candidates of [matches.filter((s) => s.name.toLocaleLowerCase("ru") === folded), matches.filter((s) => s.name.toLocaleLowerCase("ru").startsWith(folded)), matches]) { const unique = [...new Map(candidates.map((s) => [s.code, s])).values()]; if (unique.length === 1) return unique[0]!.code; if (unique.length > 1 && candidates !== matches) throw new RzdAmbiguousStationError(value, unique); }
    throw new RzdAmbiguousStationError(value, [...new Map(matches.map((s) => [s.code, s])).values()]);
  }

  /** One call fans out into an upstream request per date plus one per train, so it stays
   *  bounded twice over: a train whose compartment groups are all smaller than the party
   *  cannot hold the compartment and is never opened, and the scan stops at a request budget,
   *  naming the dates it never reached rather than passing them off as empty. */
  async searchFullCompartments(from: string | number, to: string | number, dateFrom: DateInput, dateTo: DateInput, options: { adults?: number; places?: number; maxResults?: number; maxRequests?: number; image?: boolean; maxSeconds?: number } = {}): Promise<FullCompartmentSearch> {
    this.#ensureOpen();
    const { places = 4, adults = places, maxResults = 3, maxRequests = 150, image = true, maxSeconds = 9 } = options;
    if (!Number.isInteger(places) || places < 2) throw new RzdValidationError("places must be an integer of at least two.");
    if (!Number.isInteger(maxResults) || maxResults < 1) throw new RzdValidationError("maxResults must be an integer greater than zero.");
    if (!Number.isInteger(maxRequests) || maxRequests < 1) throw new RzdValidationError("maxRequests must be an integer greater than zero.");
    // "Find me a compartment in August" arrives as the whole month even when August has begun.
    // Refusing the request over dates that have already passed helps nobody: the range starts
    // today instead, and dateFrom in the answer says so.
    const requested = parseDateTime(dateFrom, "dateFrom", { allowPast: true }), end = parseDateTime(dateTo, "dateTo", { allowPast: true });
    if (end < requested) throw new RzdValidationError("dateTo must not be earlier than dateFrom.");
    const today = new Date(`${datePart(new Date())}T00:00:00+03:00`);
    if (datePart(end) < datePart(today)) throw new RzdValidationError("The whole date range is in the past.");
    const start = requested < today ? today : requested;
    const dates = dateRange(start, end);
    if (dates.length > 31) throw new RzdValidationError("The date range must not exceed 31 days.");
    const confirmed: FullCompartmentMatch[] = [], candidates: FullCompartmentCandidate[] = [], errors: { date: string; error: string }[] = [];
    let firstCar: { car: Carriage; date: string; time: string; train: string } | undefined;
    let truncated = false, requests = 0, index = 0;
    // A serverless invocation is killed after a few seconds, and a killed call tells the caller
    // nothing at all - it looks exactly like the upstream being down. Better to stop in time and
    // hand back what was found, naming the dates that were never reached.
    const deadline = Date.now() + maxSeconds * 1000;
    for (; index < dates.length; index++) {
      const date = dates[index]!;
      if (truncated || requests >= maxRequests || Date.now() > deadline) { truncated = true; break; }
      try {
        requests++;
        const routes = await this.searchTickets(from, to, date, { adults }) as TrainRoute[];
        for (const route of routes) {
          const departureTime = route.departureTime?.slice(11, 16);
          if (!departureTime || !/^\d{2}:\d{2}$/.test(departureTime)) continue;
          if (!canHoldCompartment(route, places)) continue;
          if (requests >= maxRequests || Date.now() > deadline) { truncated = true; break; }
          requests++;
          const carriages = await this.getCarriages(from, to, date, departureTime, route.number, route.provider ?? "P1");
          const scan = findFullCompartments(carriages, places);
          if (!firstCar && scan.confirmed[0]) {
            const car = carriages.cars.find((entry) => entry.number === scan.confirmed[0]!.carNumber && entry.carType === "Compartment");
            if (car) firstCar = { car, date, time: departureTime, train: route.number };
          }
          confirmed.push(...scan.confirmed.map((match) => ({ date, trainNumber: route.number, departureTime: route.departureTime, arrivalTime: route.arrivalTime, ...match })));
          candidates.push(...scan.candidates.map((candidate) => ({ date, trainNumber: route.number, ...candidate })));
          if (confirmed.length >= maxResults) { truncated = true; break; }
        }
      } catch (error) { errors.push({ date, error: error instanceof Error ? error.message : String(error) }); }
    }
    return {
      dateFrom: dates[0]!, dateTo: dates[dates.length - 1]!, places,
      ...(image && confirmed[0] && firstCar ? await this.#drawCompartment(confirmed[0], firstCar) : {}),
      confirmed: confirmed.slice(0, maxResults), candidates: candidates.slice(0, maxResults),
      omitted: { confirmed: Math.max(0, confirmed.length - maxResults), candidates: Math.max(0, candidates.length - maxResults) },
      errors, unchecked: dates.slice(index), requests, truncated, checkedAt: moscowTimestamp(new Date()),
    };
  }

  /** The drawing is fetched without being asked for: an answer about which berths sit behind
   *  one door is exactly what a picture settles, and a client left to find one on its own
   *  illustrates the reply with photographs of some other carriage. */
  async #drawCompartment(match: FullCompartmentMatch, source: { car: Carriage; date: string; time: string; train: string }): Promise<{ image?: SearchImage }> {
    try {
      const car = source.car;
      const scheme = await this.getCarScheme(source.date, source.time, source.train, car.number!, car.carSubType!, car.serviceClass!, car.carrier!, car.numeration ?? "FromHead");
      if (scheme.schemeId === undefined) return {};
      const content = await this.getSchemeImage(scheme.schemeId, "PcFirstStorey", { free: match.places });
      const url = schemeImageUrl(this.config.publicBaseUrl, scheme.schemeId, "PcFirstStorey", match.places);
      return { image: { ...content, url, carNumber: match.carNumber, compartmentNumber: match.compartmentNumber } };
    } catch { return {}; }
  }

  async getTrainAvailability(from: string | number, to: string | number, dateFrom: DateInput, dateTo: DateInput): Promise<TrainAvailabilityResult> { const start = parseDateTime(dateFrom, "dateFrom"), end = parseDateTime(dateTo, "dateTo"); if (end < start) throw new RzdValidationError("dateTo must not be earlier than dateFrom."); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getTrainAvailability(origin, destination, datePart(start), datePart(end)); }
  async getMinimalPrices(from: string | number, to: string | number, dateFrom: DateInput): Promise<MinimalPricingResult> { const start = parseDateTime(dateFrom, "dateFrom"); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getMinimalPricing(origin, destination, datePart(start)); }
  async getCarriages(from: string | number, to: string | number, departureDate: DateInput, departureTime: string, trainNumber: string, provider = "P1"): Promise<CarriageResult> { const departure = withTime(parseDateTime(departureDate, "departureDate"), departureTime); requireText({ trainNumber, provider }); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getCarriages(origin, destination, formatDateTime(departure), trainNumber.trim(), provider.trim()); }
  async getCarScheme(departureDate: DateInput, departureTime: string, trainNumber: string, carNumber: string, carSubType: string, serviceClass: string, carrier: string, carNumeration = "FromHead"): Promise<CarScheme> { return this.api.getCarScheme(metadataInput(departureDate, departureTime, { trainNumber, carNumber, carSubType, serviceClass, carrier, carNumeration })); }
  async getSchemeImage(schemeId: number, kind: SchemeImageKind, places: SchemePlaces = {}): Promise<SchemeImageContent> { this.#ensureOpen(); return this.api.getSchemeImage(schemeId, kind, places); }
  async getCarImages(departureDate: DateInput, departureTime: string, trainNumber: string, carNumber: string, carSubType: string, serviceClass: string, carrier: string, carNumeration = "FromHead"): Promise<CarImagesResult> { return this.api.getCarImages(metadataInput(departureDate, departureTime, { trainNumber, carNumber, carSubType, serviceClass, carrier, carNumeration })); }
  async getRouteStations(from: string | number, to: string | number, departureDate: DateInput, departureTime: string, trainNumber: string, provider = "P1"): Promise<RouteStationsResult> { const departure = withTime(parseDateTime(departureDate, "departureDate"), departureTime); requireText({ trainNumber, provider }); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getRouteStations(origin, destination, formatDateTime(departure), trainNumber.trim(), provider.trim()); }
  async #resolveDirection(from: string | number, to: string | number): Promise<[string, string]> { const [origin, destination] = await Promise.all([this.resolveStationCode(from), this.resolveStationCode(to)]); if (origin === destination) throw new RzdValidationError("Origin and destination stations must be different."); return [origin, destination]; }
  #ensureOpen(): void { if (this.#closed) throw new RzdValidationError("The RZD client is closed."); }
  close(): void { if (!this.#closed) { this.#closed = true; this.#cache.clear(); this.api.close(); } }
}

function parseDateTime(input: DateInput, field: string, options: { allowPast?: boolean } = {}): Date { let value: Date; if (input instanceof Date) value = new Date(input); else { const raw = String(input).trim(); if (!raw) throw new RzdValidationError(`${field} must not be empty.`); const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw); value = match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00+03:00`) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+03:00` : raw); } if (Number.isNaN(value.valueOf())) throw new RzdValidationError(`${field} must use DD.MM.YYYY, YYYY-MM-DD or ISO datetime format.`); const today = moscowParts(new Date()); const parts = moscowParts(value); if (!options.allowPast && `${parts.year}-${parts.month}-${parts.day}` < `${today.year}-${today.month}-${today.day}`) throw new RzdValidationError(`${field} must not be in the past.`); return value; }
function moscowParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string } { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date); const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value; return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") }; }
function datePart(date: Date): string { const p = moscowParts(date); return `${p.year}-${p.month}-${p.day}`; }
function moscowTimestamp(date: Date): string { return `${formatDateTime(date)}+03:00`; }
function dateRange(start: Date, end: Date): string[] { const last = datePart(end), out: string[] = []; for (let day = new Date(`${datePart(start)}T00:00:00+03:00`); datePart(day) <= last && out.length <= 31; day = new Date(day.valueOf() + 86_400_000)) out.push(datePart(day)); return out; }
function formatDateTime(date: Date): string { const p = moscowParts(date); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; }
function withTime(date: Date, time: string): Date { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time.trim())) throw new RzdValidationError("departureTime must use HH:MM format."); return new Date(`${datePart(date)}T${time.trim()}:00+03:00`); }
function requireText(values: Record<string, string>): void { const empty = Object.entries(values).filter(([, v]) => !String(v).trim()).map(([k]) => k); if (empty.length) throw new RzdValidationError(`${empty.join(", ")} must not be empty.`); }
function metadataInput(date: DateInput, time: string, values: Record<string, string>): Record<string, string> { requireText(values); return { departureDate: formatDateTime(withTime(parseDateTime(date, "departureDate"), time)), ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])) }; }
/** A car group gathers several carriages, so it can never hold fewer free places than any
 *  single carriage inside it: when no compartment group reaches the party size, no compartment
 *  in that train can either, and its carriages need not be fetched. */
function canHoldCompartment(route: TrainRoute, places: number): boolean {
  const groups = route.carGroups.filter((group) => group.carType === undefined || group.carType === "Compartment");
  if (!groups.length) return false;
  return groups.some((group) => group.availablePlaces === undefined || group.availablePlaces >= places);
}
function filterRoutes(routes: TrainRoute[], enabled: boolean): TrainRoute[] { if (!enabled) return routes; return routes.filter((route) => { if (route.availablePlaces === undefined) throw new RzdSchemaError(`Cannot determine seat availability for train ${route.number}.`); return route.availablePlaces > 0; }); }
