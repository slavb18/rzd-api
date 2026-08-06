export type JsonObject = Record<string, unknown>;

export interface Station { name: string; code: string; raw: JsonObject; nodeId?: string; nodeType?: string; transportType?: string; region?: string }
export interface CarGroup { carType?: string; minPrice?: number; availablePlaces?: number; raw: JsonObject }
export interface TrainRoute { number: string; displayNumber?: string; originName?: string; destinationName?: string; departureTime?: string; arrivalTime?: string; minPrice?: number; availablePlaces?: number; carGroups: CarGroup[]; raw: JsonObject; routeNumber?: string; originCode?: string; destinationCode?: string; provider?: string }
export interface RoundTripResult { forward: TrainRoute[]; back: TrainRoute[]; raw: JsonObject }
export interface Carriage { number?: string; carType?: string; minPrice?: number; availablePlaces?: number; raw: JsonObject; maxPrice?: number; serviceCost?: number; carSubType?: string; carTypeName?: string; serviceClass?: string; serviceClassName?: string; schemeId?: number; schemeName?: string; carrier?: string; carrierDisplayName?: string; direction?: string; numeration?: string; trainNumber?: string; freePlaces?: string; services: string[]; hasImages?: boolean }
export interface CarriageResult { cars: Carriage[]; trainNumber?: string; originCode?: string; destinationCode?: string; departureTime?: string; routePolicy?: string; bookingSystem?: string; allowedDocumentTypes: string[]; originRetrievalDate?: string; raw: JsonObject }
export interface TrainAvailability { date: string; raw: JsonObject }
export interface TrainAvailabilityResult { originCode: string; destinationCode: string; items: TrainAvailability[]; raw: JsonObject }
export interface MinimalPrice { date: string; minPrice?: number; disabledPlaceMinPrice?: number; carriers: JsonObject[]; raw: JsonObject }
export interface MinimalPricingResult { originCode: string; destinationCode: string; prices: MinimalPrice[]; raw: JsonObject }
export interface CarScheme { schemeId?: number; carSubType?: string; startDate?: string; endDate?: string; trainNumber?: string; carrier?: string; carNumber?: string; serviceClass?: string; firstStorey?: string; secondStorey?: string; mobileFirstStorey?: string; mobileSecondStorey?: string; direction?: string; imageUrls: SchemeImage[]; raw: JsonObject }
export interface SchemeImage { kind: string; url: string }
export interface SchemeImageContent { data: string; mimeType: string }
export interface CarImage { imageId?: number; titleRu?: string; titleEn?: string; preview?: string; content?: string; sequenceNumber?: number; raw: JsonObject }
export interface CarImagesResult { schemeId?: number; carSubType?: string; images: CarImage[]; raw: JsonObject }
export interface RouteStation { name?: string; code?: string; arrivalTime?: string; departureTime?: string; distance?: number; raw: JsonObject; cityName?: string; localArrivalTime?: string; localDepartureTime?: string; stopDuration?: number; timeDescription?: string; daysFromOrigin?: number; timeZoneDifference?: number; actualMovement?: boolean; isCutawayStation?: boolean }
export interface RouteStationsResult { trainNumber?: string; stations: RouteStation[]; raw: JsonObject; routeName?: string; originName?: string; destinationName?: string }
