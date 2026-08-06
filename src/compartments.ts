import type { Carriage, CarriageResult } from "./models.js";
import { isObject } from "./transport.js";

/** A car is only ever reported as a confirmed compartment when the carriage response itself
 *  lists the required places inside one FreePlacesByCompartments group. Aggregate seat counts
 *  never confirm anything: without that breakdown the car stays a candidate. */
export type CompartmentCandidateReason = "compartment_layout_missing" | "places_not_in_one_compartment";

export interface CompartmentMatch { carNumber?: string; compartmentNumber: string; places: number[]; placeLabels: string[]; serviceClass?: string; minPrice?: number; maxPrice?: number; totalPrice?: number }
export interface CompartmentCandidate { carNumber?: string; serviceClass?: string; freePlaces: number; largestCompartment: number; reason: CompartmentCandidateReason }
export interface CompartmentScan { confirmed: CompartmentMatch[]; candidates: CompartmentCandidate[] }

export interface FullCompartmentMatch extends CompartmentMatch { date: string; trainNumber: string; departureTime?: string; arrivalTime?: string }
export interface FullCompartmentCandidate extends CompartmentCandidate { date: string; trainNumber: string }
export interface SearchImage { data: string; mimeType: string; url: string; carNumber?: string; compartmentNumber: string }
/** `requests` counts the scan only; the drawing costs one or two more. */
export interface FullCompartmentSearch { dateFrom: string; dateTo: string; places: number; image?: SearchImage; confirmed: FullCompartmentMatch[]; candidates: FullCompartmentCandidate[]; errors: { date: string; error: string }[]; omitted: { confirmed: number; candidates: number }; unchecked: string[]; requests: number; truncated: boolean; checkedAt: string }

/** Place numbers can carry a service marker: "36Ж" is a berth in a women-only compartment,
 *  "6С" one in a mixed compartment. The number decides the compartment, the marker is kept
 *  because it is what the passenger sees on the ticket. */
interface Place { number: number; label: string; minPrice?: number; maxPrice?: number }

export function findFullCompartments(result: CarriageResult, required = 4): CompartmentScan {
  const confirmed: CompartmentMatch[] = [];
  const candidates: CompartmentCandidate[] = [];
  for (const car of mergeCarriages(result.cars)) {
    if (car.free.length < required) continue;
    const full = [...car.compartments].filter(([, places]) => places.length >= required);
    if (full.length) {
      confirmed.push(...full.map(([compartmentNumber, places]) => ({
        carNumber: car.number, compartmentNumber,
        places: places.map((place) => place.number), placeLabels: places.map((place) => place.label),
        serviceClass: car.serviceClass,
        minPrice: least(places.map((place) => place.minPrice)), maxPrice: most(places.map((place) => place.maxPrice)),
        totalPrice: total(places),
      })));
      continue;
    }
    const largestCompartment = [...car.compartments.values()].reduce((max, places) => Math.max(max, places.length), 0);
    candidates.push({ carNumber: car.number, serviceClass: car.serviceClass, freePlaces: car.free.length, largestCompartment, reason: largestCompartment ? "places_not_in_one_compartment" : "compartment_layout_missing" });
  }
  return { confirmed, candidates };
}

interface MergedCar { number?: string; serviceClass?: string; free: Place[]; compartments: Map<string, Place[]> }

/** One physical carriage arrives as several entries: the lower and the upper berths of the same
 *  compartment are priced separately and come back as two cars numbered 11. Judging each entry
 *  on its own sees two free places twice and never the compartment they form together, so the
 *  entries of a carriage are joined before anything is decided. */
function mergeCarriages(cars: Carriage[]): MergedCar[] {
  const merged = new Map<string, { number?: string; serviceClasses: Set<string>; free: Map<number, Place>; compartments: Map<string, Map<number, Place>> }>();
  for (const [index, car] of cars.entries()) {
    if (car.carType !== "Compartment") continue;
    const key = car.number ?? `\0${index}`;
    const entry = merged.get(key) ?? { number: car.number, serviceClasses: new Set<string>(), free: new Map<number, Place>(), compartments: new Map<string, Map<number, Place>>() };
    merged.set(key, entry);
    if (car.serviceClass) entry.serviceClasses.add(car.serviceClass);
    for (const place of parsePlaces(car.freePlaces, car)) entry.free.set(place.number, place);
    for (const group of compartmentGroups(car)) {
      const places = entry.compartments.get(group.number) ?? new Map<number, Place>();
      entry.compartments.set(group.number, places);
      for (const place of group.places) places.set(place.number, place);
    }
  }
  return [...merged.values()].map((entry) => ({
    number: entry.number,
    serviceClass: [...entry.serviceClasses].sort().join(" / ") || undefined,
    free: sortPlaces(entry.free),
    compartments: new Map([...entry.compartments].map(([number, places]) => [number, sortPlaces(places)])),
  }));
}

function compartmentGroups(car: Carriage): { number: string; places: Place[] }[] {
  const value = car.raw.FreePlacesByCompartments;
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((node) => {
    const number = String(node.CompartmentNumber ?? "").trim();
    const places = parsePlaces(node.Places, car);
    return number && places.length ? [{ number, places }] : [];
  });
}

function parsePlaces(value: unknown, car: Carriage): Place[] {
  if (value === undefined || value === null) return [];
  const places = new Map<number, Place>();
  for (const token of String(value).split(",")) {
    const match = /^(\d+)\s*(\S*)$/.exec(token.trim());
    if (match) places.set(Number(match[1]), { number: Number(match[1]), label: `${match[1]}${match[2]}`, minPrice: car.minPrice, maxPrice: car.maxPrice ?? car.minPrice });
  }
  return sortPlaces(places);
}

function sortPlaces(places: Map<number, Place>): Place[] { return [...places.values()].sort((a, b) => a.number - b.number); }
function least(values: (number | undefined)[]): number | undefined { const known = values.filter((value): value is number => value !== undefined); return known.length ? Math.min(...known) : undefined; }
function most(values: (number | undefined)[]): number | undefined { const known = values.filter((value): value is number => value !== undefined); return known.length ? Math.max(...known) : undefined; }

/** Berths in one compartment can sit on different tariffs, so the total is the sum of the
 *  places actually taken rather than one price multiplied by their number. */
function total(places: Place[]): number | undefined {
  if (places.some((place) => place.minPrice === undefined)) return undefined;
  return round(places.reduce((sum, place) => sum + (place.minPrice ?? 0), 0));
}
function round(value: number): number { return Math.round(value * 100) / 100; }
