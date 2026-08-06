export class RzdError extends Error {}
export class RzdValidationError extends RzdError {}
export class RzdTransportError extends RzdError {}
export class RzdSchemaError extends RzdError {}

export class RzdHttpError extends RzdTransportError {
  constructor(public readonly statusCode: number, public readonly bodyPreview = "") {
    super(`RZD HTTP error ${statusCode}${bodyPreview ? `: ${bodyPreview}` : ""}`);
  }
}

export class RzdApiError extends RzdError {
  constructor(public readonly code: unknown, public readonly apiMessage: string) {
    super(`RZD API error${code == null ? "" : ` ${String(code)}`}: ${apiMessage}`);
  }
}

export class RzdStationNotFoundError extends RzdValidationError {
  constructor(public readonly query: string) { super(`Station not found: ${query}`); }
}

export class RzdAmbiguousStationError extends RzdValidationError {
  constructor(public readonly query: string, public readonly candidates: Station[]) {
    super(`Ambiguous station '${query}': ${candidates.map((s) => `${s.name} (${s.code})`).join(", ")}`);
  }
}

import type { Station } from "./models.js";
