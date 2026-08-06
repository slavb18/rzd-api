import { RzdApi } from "./api.js";
import { makeConfig, type RzdConfig } from "./config.js";
import { RzdAmbiguousStationError, RzdSchemaError, RzdStationNotFoundError, RzdValidationError } from "./errors.js";
import type { CarImagesResult, CarriageResult, CarScheme, RoundTripResult, RouteStationsResult, Station, TrainAvailabilityResult, TrainRoute, MinimalPricingResult } from "./models.js";

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

  async getTrainAvailability(from: string | number, to: string | number, dateFrom: DateInput, dateTo: DateInput): Promise<TrainAvailabilityResult> { const start = parseDateTime(dateFrom, "dateFrom"), end = parseDateTime(dateTo, "dateTo"); if (end < start) throw new RzdValidationError("dateTo must not be earlier than dateFrom."); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getTrainAvailability(origin, destination, datePart(start), datePart(end)); }
  async getMinimalPrices(from: string | number, to: string | number, dateFrom: DateInput): Promise<MinimalPricingResult> { const start = parseDateTime(dateFrom, "dateFrom"); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getMinimalPricing(origin, destination, datePart(start)); }
  async getCarriages(from: string | number, to: string | number, departureDate: DateInput, departureTime: string, trainNumber: string, provider = "P1"): Promise<CarriageResult> { const departure = withTime(parseDateTime(departureDate, "departureDate"), departureTime); requireText({ trainNumber, provider }); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getCarriages(origin, destination, formatDateTime(departure), trainNumber.trim(), provider.trim()); }
  async getCarScheme(departureDate: DateInput, departureTime: string, trainNumber: string, carNumber: string, carSubType: string, serviceClass: string, carrier: string, carNumeration = "FromHead"): Promise<CarScheme> { return this.api.getCarScheme(metadataInput(departureDate, departureTime, { trainNumber, carNumber, carSubType, serviceClass, carrier, carNumeration })); }
  async getCarImages(departureDate: DateInput, departureTime: string, trainNumber: string, carNumber: string, carSubType: string, serviceClass: string, carrier: string, carNumeration = "FromHead"): Promise<CarImagesResult> { return this.api.getCarImages(metadataInput(departureDate, departureTime, { trainNumber, carNumber, carSubType, serviceClass, carrier, carNumeration })); }
  async getRouteStations(from: string | number, to: string | number, departureDate: DateInput, departureTime: string, trainNumber: string, provider = "P1"): Promise<RouteStationsResult> { const departure = withTime(parseDateTime(departureDate, "departureDate"), departureTime); requireText({ trainNumber, provider }); const [origin, destination] = await this.#resolveDirection(from, to); return this.api.getRouteStations(origin, destination, formatDateTime(departure), trainNumber.trim(), provider.trim()); }
  async #resolveDirection(from: string | number, to: string | number): Promise<[string, string]> { const [origin, destination] = await Promise.all([this.resolveStationCode(from), this.resolveStationCode(to)]); if (origin === destination) throw new RzdValidationError("Origin and destination stations must be different."); return [origin, destination]; }
  #ensureOpen(): void { if (this.#closed) throw new RzdValidationError("The RZD client is closed."); }
  close(): void { if (!this.#closed) { this.#closed = true; this.#cache.clear(); this.api.close(); } }
}

function parseDateTime(input: DateInput, field: string): Date { let value: Date; if (input instanceof Date) value = new Date(input); else { const raw = String(input).trim(); if (!raw) throw new RzdValidationError(`${field} must not be empty.`); const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw); value = match ? new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00+03:00`) : new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+03:00` : raw); } if (Number.isNaN(value.valueOf())) throw new RzdValidationError(`${field} must use DD.MM.YYYY, YYYY-MM-DD or ISO datetime format.`); const today = moscowParts(new Date()); const parts = moscowParts(value); if (`${parts.year}-${parts.month}-${parts.day}` < `${today.year}-${today.month}-${today.day}`) throw new RzdValidationError(`${field} must not be in the past.`); return value; }
function moscowParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string } { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date); const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value; return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") }; }
function datePart(date: Date): string { const p = moscowParts(date); return `${p.year}-${p.month}-${p.day}`; }
function formatDateTime(date: Date): string { const p = moscowParts(date); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; }
function withTime(date: Date, time: string): Date { if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time.trim())) throw new RzdValidationError("departureTime must use HH:MM format."); return new Date(`${datePart(date)}T${time.trim()}:00+03:00`); }
function requireText(values: Record<string, string>): void { const empty = Object.entries(values).filter(([, v]) => !String(v).trim()).map(([k]) => k); if (empty.length) throw new RzdValidationError(`${empty.join(", ")} must not be empty.`); }
function metadataInput(date: DateInput, time: string, values: Record<string, string>): Record<string, string> { requireText(values); return { departureDate: formatDateTime(withTime(parseDateTime(date, "departureDate"), time)), ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])) }; }
function filterRoutes(routes: TrainRoute[], enabled: boolean): TrainRoute[] { if (!enabled) return routes; return routes.filter((route) => { if (route.availablePlaces === undefined) throw new RzdSchemaError(`Cannot determine seat availability for train ${route.number}.`); return route.availablePlaces > 0; }); }
