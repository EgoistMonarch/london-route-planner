export const LOCATION_OPTIONS = [
  { key: "kings-cross", name: "King's Cross St Pancras", shortName: "King's Cross", lat: 51.5308, lng: -0.1238 },
  { key: "greenwich", name: "Greenwich Market", shortName: "Greenwich", lat: 51.4815, lng: -0.0094 },
  { key: "stratford", name: "Stratford Station", shortName: "Stratford", lat: 51.5413, lng: -0.0032 },
  { key: "south-kensington", name: "South Kensington", shortName: "South Kensington", lat: 51.4941, lng: -0.1738 },
  { key: "paddington", name: "Paddington Station", shortName: "Paddington", lat: 51.5154, lng: -0.1755 },
  { key: "bank", name: "Bank Station", shortName: "Bank", lat: 51.5133, lng: -0.089 },
  { key: "camden-town", name: "Camden Town", shortName: "Camden Town", lat: 51.5392, lng: -0.1426 },
  { key: "london-bridge", name: "London Bridge", shortName: "London Bridge", lat: 51.5055, lng: -0.0865 },
  { key: "victoria", name: "London Victoria", shortName: "Victoria", lat: 51.4965, lng: -0.1447 },
  { key: "waterloo", name: "London Waterloo", shortName: "Waterloo", lat: 51.5033, lng: -0.1147 },
  { key: "canary-wharf", name: "Canary Wharf", shortName: "Canary Wharf", lat: 51.5054, lng: -0.0235 },
  { key: "heathrow-t5", name: "Heathrow Terminal 5", shortName: "Heathrow T5", lat: 51.4722, lng: -0.488 },
  { key: "wembley-park", name: "Wembley Park", shortName: "Wembley Park", lat: 51.5635, lng: -0.2795 },
  { key: "brixton", name: "Brixton", shortName: "Brixton", lat: 51.4627, lng: -0.1145 },
  { key: "shoreditch", name: "Shoreditch High Street", shortName: "Shoreditch", lat: 51.5235, lng: -0.0755 },
  { key: "tower-hill", name: "Tower Hill", shortName: "Tower Hill", lat: 51.5101, lng: -0.076 },
] as const;

export type LocationKey = (typeof LOCATION_OPTIONS)[number]["key"];
export type LondonLocation = (typeof LOCATION_OPTIONS)[number];

export const LOCATION_BY_KEY = Object.fromEntries(
  LOCATION_OPTIONS.map((location) => [location.key, location]),
) as Record<LocationKey, LondonLocation>;

export const TRANSPORT_MODE_OPTIONS = [
  { key: "recommended", label: "Recommended", shortLabel: "Best mix", symbol: "↗", tflModes: "tube,dlr,overground,elizabeth-line,national-rail,bus,walking" },
  { key: "rail", label: "Rail & Tube", shortLabel: "Rail first", symbol: "U", tflModes: "tube,dlr,overground,elizabeth-line,national-rail,walking" },
  { key: "bus", label: "Bus", shortLabel: "Bus & walk", symbol: "B", tflModes: "bus,walking" },
  { key: "drive", label: "Driving", shortLabel: "Live roads", symbol: "D", tflModes: "" },
  { key: "walking", label: "Walking", shortLabel: "On foot", symbol: "W", tflModes: "walking" },
  { key: "cycling", label: "Cycling", shortLabel: "Bike route", symbol: "C", tflModes: "cycle" },
] as const;

export type TransportMode = (typeof TRANSPORT_MODE_OPTIONS)[number]["key"];

export function isLocationKey(value: unknown): value is LocationKey {
  return typeof value === "string" && LOCATION_OPTIONS.some((location) => location.key === value);
}

export function isTransportMode(value: unknown): value is TransportMode {
  return typeof value === "string" && TRANSPORT_MODE_OPTIONS.some((mode) => mode.key === value);
}

export function getTransportMode(mode: TransportMode) {
  return TRANSPORT_MODE_OPTIONS.find((option) => option.key === mode) ?? TRANSPORT_MODE_OPTIONS[0];
}
