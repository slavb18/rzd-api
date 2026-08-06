import type { Carriage, CarriageResult } from "./models.js";
import { isObject } from "./transport.js";

/** A car is only ever reported as a confirmed compartment when the carriage response itself
 *  lists the required places inside one FreePlacesByCompartments group. Aggregate seat counts
 *  never confirm anything: without that breakdown the car stays a candidate. */
export type CompartmentCandidateReason = "compartment_layout_missing" | "places_not_in_one_compartment";

export interface CompartmentMatch { carNumber?: string; compartmentNumber: string; places: number[]; serviceClass?: string; minPrice?: number; maxPrice?: number; totalPrice?: number }
export interface CompartmentCandidate { carNumber?: string; serviceClass?: string; freePlaces: number; largestCompartment: number; reason: CompartmentCandidateReason }
export interface CompartmentScan { confirmed: CompartmentMatch[]; candidates: CompartmentCandidate[] }

export interface FullCompartmentMatch extends CompartmentMatch { date: string; trainNumber: string; departureTime?: string; arrivalTime?: string }
export interface FullCompartmentCandidate extends CompartmentCandidate { date: string; trainNumber: string }
export interface FullCompartmentSearch { dateFrom: string; dateTo: string; places: number; confirmed: FullCompartmentMatch[]; candidates: FullCompartmentCandidate[]; errors: { date: string; error: string }[]; truncated: boolean; checkedAt: string }

export function findFullCompartments(result: CarriageResult, required = 4): CompartmentScan {
  const confirmed: CompartmentMatch[] = [];
  const candidates: CompartmentCandidate[] = [];
  for (const car of result.cars) {
    if (car.carType !== "Compartment") continue;
    const free = placeNumbers(car.freePlaces);
    if ((free.length || car.availablePlaces || 0) < required) continue;
    const groups = compartmentGroups(car);
    const full = groups.filter((group) => group.places.length >= required);
    if (full.length) {
      confirmed.push(...full.map((group) => ({ carNumber: car.number, compartmentNumber: group.number, places: group.places, serviceClass: car.serviceClass, minPrice: car.minPrice, maxPrice: car.maxPrice, totalPrice: car.minPrice === undefined ? undefined : round(car.minPrice * group.places.length) })));
      continue;
    }
    const largestCompartment = groups.reduce((max, group) => Math.max(max, group.places.length), 0);
    candidates.push({ carNumber: car.number, serviceClass: car.serviceClass, freePlaces: free.length || car.availablePlaces || 0, largestCompartment, reason: largestCompartment ? "places_not_in_one_compartment" : "compartment_layout_missing" });
  }
  return { confirmed, candidates };
}

function compartmentGroups(car: Carriage): { number: string; places: number[] }[] {
  const value = car.raw.FreePlacesByCompartments;
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).flatMap((node) => {
    const number = String(node.CompartmentNumber ?? "").trim();
    const places = placeNumbers(node.Places);
    return number && places.length ? [{ number, places }] : [];
  });
}

function placeNumbers(value: unknown): number[] {
  if (value === undefined || value === null) return [];
  const places = String(value).split(",").map((place) => place.trim()).filter((place) => /^\d+$/.test(place)).map(Number);
  return [...new Set(places)].sort((a, b) => a - b);
}

function round(value: number): number { return Math.round(value * 100) / 100; }
