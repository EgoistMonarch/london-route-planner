import {
  LOCATION_BY_KEY,
  getTransportMode,
  type LocationKey,
  type LondonLocation,
  type TransportMode,
} from "./route-config";

/**
 * PUBLIC API MAP — all external requests are made server-side in this file.
 *
 * No API keys, tokens, account IDs or credentials are embedded.
 * - TfL Journey Planner: https://api.tfl.gov.uk/Journey/JourneyResults/...
 * - TfL live arrivals:   https://api.tfl.gov.uk/StopPoint/{id}/Arrivals
 * - TfL road disruption: https://api.tfl.gov.uk/Road/all/Disruption
 * - TfL line status:     https://api.tfl.gov.uk/Line/Mode/.../Status
 * - TfL cycle hire:      https://api.tfl.gov.uk/BikePoint
 * - Police.uk context:   https://data.police.uk/api/...
 * - OSRM road routing:   https://router.project-osrm.org/route/v1/driving/...
 *
 * fetchJson() below is the single timeout/error boundary for these providers.
 * If a future deployment adds an API key, read it from a server environment
 * variable and keep .env.local untracked; never put a key in this source file.
 */

export type { LocationKey, TransportMode } from "./route-config";

export type GeoPoint = { lat: number; lng: number };

export type RouteRequest = {
  from: LocationKey;
  to: LocationKey;
  mode?: TransportMode;
  injectFailure?: boolean;
};

export type RouteLeg = {
  mode: string;
  line: string;
  from: string;
  to: string;
  minutes: number;
  instruction: string;
  departureStopId?: string;
  lineId?: string;
};

export type JourneyResult = {
  legs: RouteLeg[];
  duration: number;
  path: GeoPoint[];
};

export type SafetyContext = {
  level: "Lower" | "Typical" | "Elevated" | "Unknown";
  incidents: number | null;
  month: string | null;
  publishedAgeMonths: number | null;
  note: string;
  sourceMode: "published" | "fallback" | "unavailable";
};

export type TrafficAlert = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  distanceKm: number;
  updatedAt: string | null;
};

export type TrafficContext = {
  level: "Low" | "Moderate" | "High" | "Unknown";
  disruptions: number | null;
  note: string;
  sourceMode: "live" | "substitute" | "unavailable";
  scope: "route" | "network";
  updatedAt: string | null;
  alerts: TrafficAlert[];
};

export type MobilityContext = {
  label: string;
  value: string;
  note: string;
  sourceMode: "live" | "fallback" | "unavailable";
  sourceName?: string;
  updatedAt: string | null;
};

export type DecisionEvent = {
  id: number;
  kind: "decision" | "fetch" | "success" | "failure" | "recovery";
  title: string;
  detail: string;
  source?: string;
  reused?: boolean;
};

type SourceState = "live" | "published" | "backup" | "fallback" | "failed" | "substitute";

export type AgentResult = {
  requestId: string;
  generatedAt: string;
  from: string;
  to: string;
  selectedMode: TransportMode;
  selectedModeLabel: string;
  durationMinutes: number;
  walkingMinutes: number;
  changes: number;
  confidence: "High" | "Medium";
  routeSource: "live" | "backup" | "fallback";
  routeSourceLabel: string;
  routePath: GeoPoint[];
  legs: RouteLeg[];
  decisions: DecisionEvent[];
  safety: SafetyContext;
  traffic: TrafficContext;
  mobility: MobilityContext;
  liveRefreshSeconds: number;
  recovery: {
    occurred: boolean;
    failedSource: string | null;
    action: "substitute" | "retry" | "skip" | "none";
    cachedItemsReused: string[];
    completedStepsReplayed: number;
    message: string;
  };
  sources: Array<{ name: string; role: string; state: SourceState }>;
};

export type LiveRefreshResult = {
  generatedAt: string;
  status: "fresh" | "partial" | "cached";
  traffic?: TrafficContext;
  mobility?: MobilityContext;
  retained: Array<"traffic" | "mobility">;
  message: string;
};

export type AgentProviders = {
  getJourney: (from: LondonLocation, to: LondonLocation, mode: TransportMode) => Promise<JourneyResult>;
  getBackupJourney: (from: LondonLocation, to: LondonLocation, mode: TransportMode) => Promise<JourneyResult>;
  getSafety: (midpoint: GeoPoint) => Promise<SafetyContext>;
  getTraffic: (injectFailure: boolean, path: GeoPoint[], mode: TransportMode) => Promise<TrafficContext>;
  getLineStatus: (route: RouteLeg[]) => Promise<TrafficContext>;
  getMobilityContext: (from: LondonLocation, route: RouteLeg[], mode: TransportMode) => Promise<MobilityContext>;
};

export class DataSourceError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly code: "TIMEOUT" | "HTTP" | "INJECTED" | "INVALID",
  ) {
    super(message);
    this.name = "DataSourceError";
  }
}

async function fetchJson<T>(source: string, url: string, timeoutMs = 3500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new DataSourceError(`${source} returned HTTP ${response.status}`, source, "HTTP");
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DataSourceError) throw error;
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    throw new DataSourceError(
      timedOut ? `${source} timed out` : message,
      source,
      timedOut ? "TIMEOUT" : "HTTP",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function prettyMode(mode: string) {
  const value = mode.toLowerCase();
  if (value.includes("walking")) return "Walk";
  if (value.includes("cycle")) return "Cycle";
  if (value.includes("car") || value.includes("driv")) return "Drive";
  if (value.includes("bus")) return "Bus";
  if (value.includes("elizabeth")) return "Elizabeth line";
  if (value.includes("overground")) return "Overground";
  if (value.includes("national-rail")) return "Rail";
  if (value.includes("dlr")) return "DLR";
  return "Tube";
}

function validPoint(point: GeoPoint) {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

function downsamplePath(path: GeoPoint[], maximum = 300) {
  const clean = path.filter(validPoint);
  if (clean.length <= maximum) return clean;
  const stride = (clean.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => clean[Math.round(index * stride)]);
}

function parseTflPath(lineString?: string): GeoPoint[] {
  if (!lineString) return [];
  try {
    const values = JSON.parse(lineString) as Array<[number, number]>;
    return values.map(([lat, lng]) => ({ lat, lng })).filter(validPoint);
  } catch {
    return [];
  }
}

type TflJourneyResponse = {
  journeys?: Array<{
    duration?: number;
    legs?: Array<{
      duration?: number;
      mode?: { name?: string };
      instruction?: { summary?: string; detailed?: string };
      departurePoint?: { commonName?: string; naptanId?: string; lat?: number; lon?: number };
      arrivalPoint?: { commonName?: string; lat?: number; lon?: number };
      path?: { lineString?: string };
      routeOptions?: Array<{
        name?: string;
        id?: string;
        lineIdentifier?: { id?: string; name?: string };
      }>;
    }>;
  }>;
};

async function getLiveJourney(from: LondonLocation, to: LondonLocation, mode: TransportMode) {
  const origin = encodeURIComponent(`${from.lat},${from.lng}`);
  const destination = encodeURIComponent(`${to.lat},${to.lng}`);
  const modeConfig = getTransportMode(mode);
  const url =
    `https://api.tfl.gov.uk/Journey/JourneyResults/${origin}/to/${destination}` +
    `?mode=${encodeURIComponent(modeConfig.tflModes)}&journeyPreference=LeastTime`;
  const data = await fetchJson<TflJourneyResponse>("TfL Journey Planner", url, 5000);
  const journey = data.journeys?.[0];
  if (!journey?.legs?.length) {
    throw new DataSourceError("TfL returned no usable journey", "TfL Journey Planner", "INVALID");
  }

  const path: GeoPoint[] = [];
  const legs: RouteLeg[] = journey.legs.map((leg) => {
    const modeName = prettyMode(leg.mode?.name ?? "tube");
    const option = leg.routeOptions?.[0];
    const legPath = parseTflPath(leg.path?.lineString);
    if (legPath.length) path.push(...legPath);
    else {
      if (typeof leg.departurePoint?.lat === "number" && typeof leg.departurePoint.lon === "number") {
        path.push({ lat: leg.departurePoint.lat, lng: leg.departurePoint.lon });
      }
      if (typeof leg.arrivalPoint?.lat === "number" && typeof leg.arrivalPoint.lon === "number") {
        path.push({ lat: leg.arrivalPoint.lat, lng: leg.arrivalPoint.lon });
      }
    }
    return {
      mode: modeName,
      line: option?.lineIdentifier?.name || option?.name || (modeName === "Walk" ? "On foot" : modeName),
      from: leg.departurePoint?.commonName || from.shortName,
      to: leg.arrivalPoint?.commonName || to.shortName,
      minutes: Math.max(1, Math.round(leg.duration ?? 1)),
      instruction: leg.instruction?.summary || leg.instruction?.detailed || `Continue by ${modeName}`,
      departureStopId: leg.departurePoint?.naptanId,
      lineId: option?.lineIdentifier?.id || option?.id,
    };
  });
  return {
    legs,
    duration: journey.duration ?? legs.reduce((sum, leg) => sum + leg.minutes, 0),
    path: downsamplePath(path.length ? path : [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }]),
  };
}

function straightLineMetres(from: LondonLocation, to: LondonLocation) {
  const radius = 6_371_000;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type FallbackMetrics = {
  distanceMetres?: number;
  roadDurationSeconds?: number;
  path?: GeoPoint[];
  independentRoadResult?: boolean;
};

function fallbackJourney(
  from: LondonLocation,
  to: LondonLocation,
  mode: TransportMode,
  metrics: FallbackMetrics = {},
): JourneyResult {
  const distanceMetres = metrics.distanceMetres ?? straightLineMetres(from, to) * 1.25;
  const path = downsamplePath(metrics.path?.length ? metrics.path : [
    { lat: from.lat, lng: from.lng },
    { lat: to.lat, lng: to.lng },
  ]);

  if (mode === "drive") {
    const minutes = Math.max(5, Math.round((metrics.roadDurationSeconds ?? distanceMetres / 8) / 60));
    return {
      duration: minutes,
      path,
      legs: [{
        mode: "Drive",
        line: metrics.independentRoadResult ? "OSRM road route" : "Estimated road route",
        from: from.name,
        to: to.name,
        minutes,
        instruction: "Follow current road signs and the route-local TfL traffic warnings shown here",
      }],
    };
  }
  if (mode === "walking" || (metrics.independentRoadResult && ["recommended", "rail", "bus"].includes(mode))) {
    const minutes = Math.max(4, Math.round(distanceMetres / 75));
    return {
      duration: minutes,
      path,
      legs: [{
        mode: "Walk",
        line: metrics.independentRoadResult ? "Emergency walking contingency" : "Walking estimate",
        from: from.name,
        to: to.name,
        minutes,
        instruction: metrics.independentRoadResult
          ? "Live transit routing is unavailable; this is an honest road-network walking contingency, not a transport timetable"
          : "Follow signed pedestrian routes and verify crossings on departure",
      }],
    };
  }
  if (mode === "cycling") {
    const minutes = Math.max(4, Math.round(distanceMetres / 220));
    return {
      duration: minutes,
      path,
      legs: [{
        mode: "Cycle",
        line: metrics.independentRoadResult ? "OSRM road-network contingency" : "Cycle estimate",
        from: from.name,
        to: to.name,
        minutes,
        instruction: "Use signed cycle infrastructure where available and verify restrictions on departure",
      }],
    };
  }

  if (`${from.key}:${to.key}` === "kings-cross:greenwich") {
    return {
      duration: 36,
      path,
      legs: [
        { mode: "Walk", line: "On foot", from: from.name, to: "Northern line platforms", minutes: 5, instruction: "Enter via Euston Road and follow signs for the Northern line" },
        { mode: "Tube", line: "Northern line", from: from.name, to: "London Bridge", minutes: 11, instruction: "Confirm the southbound Northern line on station displays" },
        { mode: "Rail", line: "Southeastern", from: "London Bridge", to: "Greenwich", minutes: 13, instruction: "Confirm a Southeastern service on station displays" },
        { mode: "Walk", line: "On foot", from: "Greenwich Station", to: to.name, minutes: 7, instruction: "Walk north-east via Greenwich High Road" },
      ],
    };
  }

  const mainMinutes = Math.max(8, Math.round(distanceMetres / (mode === "bus" ? 240 : 500)));
  const mainMode = mode === "bus" ? "Bus" : "Rail";
  return {
    duration: mainMinutes + 10,
    path,
    legs: [
      { mode: "Walk", line: "On foot", from: from.name, to: `${from.shortName} departure point`, minutes: 5, instruction: "Walk to the nearest suitable departure point" },
      { mode: mainMode, line: "Static network contingency", from: from.shortName, to: to.shortName, minutes: mainMinutes, instruction: "Confirm the service on live stop or station displays before boarding" },
      { mode: "Walk", line: "On foot", from: `${to.shortName} arrival point`, to: to.name, minutes: 5, instruction: `Continue on foot to ${to.name}` },
    ],
  };
}

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { type?: string; coordinates?: Array<[number, number]> };
  }>;
};

async function getOsrmRoadMetrics(from: LondonLocation, to: LondonLocation) {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const data = await fetchJson<OsrmResponse>("OSRM/OpenStreetMap", url, 5000);
  const route = data.routes?.[0];
  if (data.code !== "Ok" || !route?.distance) {
    throw new DataSourceError("OSRM returned no usable road route", "OSRM/OpenStreetMap", "INVALID");
  }
  const path = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));
  return {
    distanceMetres: route.distance,
    roadDurationSeconds: route.duration,
    path: downsamplePath(path),
    independentRoadResult: true,
  } satisfies FallbackMetrics;
}

async function getPrimaryJourney(from: LondonLocation, to: LondonLocation, mode: TransportMode) {
  if (mode !== "drive") return getLiveJourney(from, to, mode);
  const metrics = await getOsrmRoadMetrics(from, to);
  return fallbackJourney(from, to, mode, metrics);
}

async function getOsrmBackupJourney(from: LondonLocation, to: LondonLocation, mode: TransportMode) {
  const metrics = await getOsrmRoadMetrics(from, to);
  return fallbackJourney(from, to, mode, metrics);
}

type CrimeAvailability = Array<{ date?: string }>;
type CrimeItem = { category?: string; month?: string };

function ageInMonths(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const now = new Date();
  return Math.max(0, now.getUTCFullYear() * 12 + now.getUTCMonth() - (year * 12 + monthNumber - 1));
}

async function getSafety(midpoint: GeoPoint): Promise<SafetyContext> {
  const dates = await fetchJson<CrimeAvailability>(
    "Police.uk availability",
    "https://data.police.uk/api/crimes-street-dates",
    3000,
  );
  const month = dates[0]?.date;
  if (!month) throw new DataSourceError("No safety month available", "Police.uk", "INVALID");
  const url = `https://data.police.uk/api/crimes-at-location?date=${encodeURIComponent(month)}&lat=${midpoint.lat}&lng=${midpoint.lng}`;
  const crimes = await fetchJson<CrimeItem[]>("Police.uk", url, 3500);
  const incidents = crimes.length;
  const level = incidents <= 4 ? "Lower" : incidents <= 11 ? "Typical" : "Elevated";
  const publishedAgeMonths = ageInMonths(month);
  return {
    level,
    incidents,
    month,
    publishedAgeMonths,
    note: `${incidents} incident${incidents === 1 ? "" : "s"} at the nearest anonymised location for ${month}. Published ${publishedAgeMonths} month${publishedAgeMonths === 1 ? "" : "s"} ago; this is historic context, not live safety data or a prediction.`,
    sourceMode: "published",
  };
}

type RoadDisruption = {
  id?: string;
  severity?: string;
  comments?: string;
  currentUpdate?: string;
  currentUpdateDateTime?: string;
  lastModifiedTime?: string;
  location?: string;
  status?: string;
  hasClosures?: boolean;
  geography?: { coordinates?: [number, number] };
};

function projectedPoint(point: GeoPoint, referenceLat: number) {
  return {
    x: point.lng * 111.32 * Math.cos((referenceLat * Math.PI) / 180),
    y: point.lat * 110.574,
  };
}

export function distanceToRouteKm(point: GeoPoint, path: GeoPoint[]) {
  if (!path.length) return Number.POSITIVE_INFINITY;
  if (path.length === 1) {
    const a = projectedPoint(point, point.lat);
    const b = projectedPoint(path[0], point.lat);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  const p = projectedPoint(point, point.lat);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < path.length; index += 1) {
    const a = projectedPoint(path[index - 1], point.lat);
    const b = projectedPoint(path[index], point.lat);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
    const nearestX = a.x + ratio * dx;
    const nearestY = a.y + ratio * dy;
    minimum = Math.min(minimum, Math.hypot(p.x - nearestX, p.y - nearestY));
  }
  return minimum;
}

async function getTraffic(
  injectFailure: boolean,
  path: GeoPoint[],
  mode: TransportMode,
): Promise<TrafficContext> {
  if (injectFailure) {
    throw new DataSourceError(
      "Injected HTTP 503 for the recovery demonstration",
      "TfL Road Disruptions",
      "INJECTED",
    );
  }
  const data = await fetchJson<RoadDisruption[]>(
    "TfL Road Disruptions",
    "https://api.tfl.gov.uk/Road/all/Disruption",
    4000,
  );
  const thresholdKm = mode === "drive" || mode === "bus" ? 1.25 : 0.75;
  const alerts = data
    .filter((item) => item.status !== "Inactive" && item.geography?.coordinates)
    .map((item) => {
      const [lng, lat] = item.geography?.coordinates ?? [Number.NaN, Number.NaN];
      const distanceKm = distanceToRouteKm({ lat, lng }, path);
      return {
        id: item.id ?? `${lat}:${lng}`,
        severity: item.severity ?? "Unknown",
        title: item.location || item.comments || "Road disruption",
        detail: item.currentUpdate || item.comments || "Check TfL before departure.",
        distanceKm: Number(distanceKm.toFixed(1)),
        updatedAt: item.currentUpdateDateTime || item.lastModifiedTime || null,
        hasClosures: Boolean(item.hasClosures),
      };
    })
    .filter((item) => item.distanceKm <= thresholdKm)
    .sort((a, b) => {
      const score = (item: typeof a) => item.hasClosures ? 3 : item.severity.toLowerCase() === "serious" ? 2 : 1;
      return score(b) - score(a) || a.distanceKm - b.distanceKm;
    });
  const highImpact = alerts.filter((alert) => alert.hasClosures || alert.severity.toLowerCase() === "serious");
  const level = highImpact.length ? "High" : alerts.length ? "Moderate" : "Low";
  const updatedAt = alerts
    .map((alert) => alert.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? new Date().toISOString();
  return {
    level,
    disruptions: alerts.length,
    note: alerts.length
      ? `${alerts.length} active TfL road disruption${alerts.length === 1 ? "" : "s"} within ${thresholdKm} km of this route, filtered from ${data.length} London-wide records.`
      : `No active TfL road disruption was found within ${thresholdKm} km of this route (${data.length} London-wide records checked).`,
    sourceMode: "live",
    scope: "route",
    updatedAt,
    alerts: alerts.slice(0, 5).map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      title: alert.title,
      detail: alert.detail,
      distanceKm: alert.distanceKm,
      updatedAt: alert.updatedAt,
    })),
  };
}

type LineStatus = Array<{
  name?: string;
  lineStatuses?: Array<{ statusSeverityDescription?: string }>;
}>;

async function getLineStatusSubstitute(route: RouteLeg[]): Promise<TrafficContext> {
  const data = await fetchJson<LineStatus>(
    "TfL Line Status",
    "https://api.tfl.gov.uk/Line/Mode/tube,dlr,overground,elizabeth-line/Status",
    3500,
  );
  const routeNames = route.map((leg) => leg.line.toLowerCase());
  const relevant = data.filter((line) =>
    routeNames.some((name) => name.includes((line.name ?? "").toLowerCase())),
  );
  const problems = (relevant.length ? relevant : data).filter((line) =>
    (line.lineStatuses ?? []).some((status) => status.statusSeverityDescription !== "Good Service"),
  );
  return {
    level: problems.length ? "Moderate" : "Low",
    disruptions: problems.length,
    note: problems.length
      ? `Road data was unavailable; ${problems.length} relevant network status issue${problems.length === 1 ? "" : "s"} is being used as a narrower delay proxy.`
      : "Road data was unavailable; current TfL line status shows no relevant service issue.",
    sourceMode: "substitute",
    scope: "network",
    updatedAt: new Date().toISOString(),
    alerts: [],
  };
}

type Arrival = {
  expectedArrival?: string;
  lineName?: string;
  lineId?: string;
  destinationName?: string;
};
type BikePoint = {
  commonName?: string;
  lat?: number;
  lon?: number;
  additionalProperties?: Array<{ key?: string; value?: string }>;
};

async function getLiveMobilityContext(
  from: LondonLocation,
  route: RouteLeg[],
  mode: TransportMode,
): Promise<MobilityContext> {
  if (mode === "walking" || mode === "drive") {
    return {
      label: mode === "drive" ? "Road monitoring" : "Live vehicle feed",
      value: mode === "drive" ? "Active" : "Not needed",
      note: mode === "drive"
        ? "Route-local TfL road alerts are refreshed separately."
        : "This journey is fully on foot, so vehicle arrivals would not improve it.",
      sourceMode: "fallback",
      updatedAt: null,
    };
  }
  if (mode === "cycling") {
    const points = await fetchJson<BikePoint[]>(
      "TfL Cycle Hire",
      "https://api.tfl.gov.uk/BikePoint",
      4000,
    );
    const nearest = points
      .filter((point) => typeof point.lat === "number" && typeof point.lon === "number")
      .sort((a, b) =>
        Math.hypot((a.lat ?? 0) - from.lat, (a.lon ?? 0) - from.lng) -
        Math.hypot((b.lat ?? 0) - from.lat, (b.lon ?? 0) - from.lng),
      )[0];
    if (!nearest) {
      throw new DataSourceError("No cycle-hire point returned", "TfL Cycle Hire", "INVALID");
    }
    const properties = Object.fromEntries(
      (nearest.additionalProperties ?? []).map((property) => [property.key, property.value]),
    );
    const bikes = Number(properties.NbBikes ?? 0);
    const spaces = Number(properties.NbEmptyDocks ?? 0);
    return {
      label: "Nearest cycle hire",
      value: `${bikes} bike${bikes === 1 ? "" : "s"}`,
      note: `${nearest.commonName ?? "Nearest docking station"}: ${spaces} empty dock${spaces === 1 ? "" : "s"}.`,
      sourceMode: "live",
      sourceName: "TfL Cycle Hire",
      updatedAt: new Date().toISOString(),
    };
  }

  const transitLeg = route.find((leg) => leg.mode !== "Walk" && leg.departureStopId);
  if (!transitLeg?.departureStopId) {
    return {
      label: "Live arrivals",
      value: "Check display",
      note: "The contingency route has no live stop identifier; confirm the next service at departure.",
      sourceMode: "fallback",
      updatedAt: null,
    };
  }
  const arrivals = await fetchJson<Arrival[]>(
    "TfL Live Arrivals",
    `https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(transitLeg.departureStopId)}/Arrivals`,
    3500,
  );
  const timed = arrivals
    .filter((arrival) => arrival.expectedArrival)
    .sort((a, b) =>
      new Date(a.expectedArrival ?? 0).getTime() - new Date(b.expectedArrival ?? 0).getTime(),
    );
  const next = timed.find((arrival) => !transitLeg.lineId || arrival.lineId === transitLeg.lineId) ?? timed[0];
  if (!next?.expectedArrival) {
    throw new DataSourceError("No live arrival prediction returned", "TfL Live Arrivals", "INVALID");
  }
  const minutes = Math.max(
    0,
    Math.round((new Date(next.expectedArrival).getTime() - Date.now()) / 60_000),
  );
  return {
    label: "Next live service",
    value: `${minutes} min`,
    note: `${next.lineName ?? transitLeg.line} towards ${next.destinationName ?? transitLeg.to}.`,
    sourceMode: "live",
    sourceName: "TfL Live Arrivals",
    updatedAt: new Date().toISOString(),
  };
}

function fallbackSafety(): SafetyContext {
  return {
    level: "Unknown",
    incidents: null,
    month: null,
    publishedAgeMonths: null,
    note: "Published Police.uk context is unavailable. The route remains usable; stay aware on walking legs.",
    sourceMode: "fallback",
  };
}

function fallbackTraffic(route: RouteLeg[]): TrafficContext {
  const exposedLegs = route.filter((leg) =>
    ["Bus", "Walk", "Cycle", "Drive"].includes(leg.mode),
  );
  return {
    level: "Unknown",
    disruptions: null,
    note: `No live traffic source responded. Continue with the cached route; ${exposedLegs.length} road-exposed leg${exposedLegs.length === 1 ? "" : "s"} should be checked on departure.`,
    sourceMode: "unavailable",
    scope: "route",
    updatedAt: null,
    alerts: [],
  };
}

function fallbackMobility(mode: TransportMode): MobilityContext {
  return {
    label: mode === "cycling" ? "Cycle availability" : mode === "drive" ? "Road monitoring" : "Live arrivals",
    value: "Unavailable",
    note: "The route remains usable; confirm live availability at departure.",
    sourceMode: "unavailable",
    updatedAt: null,
  };
}

export const liveProviders: AgentProviders = {
  getJourney: getPrimaryJourney,
  getBackupJourney: getOsrmBackupJourney,
  getSafety,
  getTraffic,
  getLineStatus: getLineStatusSubstitute,
  getMobilityContext: getLiveMobilityContext,
};

export async function refreshLiveData(
  request: {
    from: LocationKey;
    mode: TransportMode;
    legs: RouteLeg[];
    routePath: GeoPoint[];
  },
  providers: AgentProviders = liveProviders,
): Promise<LiveRefreshResult> {
  const from = LOCATION_BY_KEY[request.from];
  const retained: LiveRefreshResult["retained"] = [];
  let traffic: TrafficContext | undefined;
  let mobility: MobilityContext | undefined;

  try {
    traffic = await providers.getTraffic(false, downsamplePath(request.routePath), request.mode);
  } catch {
    retained.push("traffic");
  }

  if (request.mode !== "drive" && request.mode !== "walking") {
    try {
      mobility = await providers.getMobilityContext(from, request.legs, request.mode);
    } catch {
      retained.push("mobility");
    }
  }

  const status = retained.length === 0 ? "fresh" : traffic || mobility ? "partial" : "cached";
  return {
    generatedAt: new Date().toISOString(),
    status,
    traffic,
    mobility,
    retained,
    message: status === "fresh"
      ? "Live arrivals and route-local disruption data refreshed."
      : status === "partial"
        ? `Some live sources failed; retained cached ${retained.join(" and ")} data.`
        : "Live refresh failed; all previously displayed data was retained.",
  };
}

export async function planRoute(
  request: RouteRequest,
  providers: AgentProviders = liveProviders,
): Promise<AgentResult> {
  const from = LOCATION_BY_KEY[request.from];
  const to = LOCATION_BY_KEY[request.to];
  const selectedMode = request.mode ?? "recommended";
  const modeConfig = getTransportMode(selectedMode);
  if (!from || !to || from.key === to.key) {
    throw new Error("Choose two different supported London locations.");
  }

  const decisions: DecisionEvent[] = [];
  const cache = new Map<string, unknown>();
  const failedSources: string[] = [];
  const recoveryState: {
    occurred: boolean;
    action: "substitute" | "retry" | "skip" | "none";
    cachedItemsReused: string[];
  } = { occurred: false, action: "none", cachedItemsReused: [] };
  const sources: AgentResult["sources"] = [];
  let eventId = 0;
  const log = (event: Omit<DecisionEvent, "id">) => decisions.push({ id: ++eventId, ...event });
  const rememberFailure = (source: string) => {
    recoveryState.occurred = true;
    if (!failedSources.includes(source)) failedSources.push(source);
  };
  const rememberCache = (key: string) => {
    if (cache.has(key) && !recoveryState.cachedItemsReused.includes(key)) {
      recoveryState.cachedItemsReused.push(key);
    }
  };

  const primarySource = selectedMode === "drive" ? "OSRM/OpenStreetMap" : "TfL Journey Planner";
  log({
    kind: "decision",
    title: "Fetch route structure first",
    detail: `The ${modeConfig.label.toLowerCase()} choice selects ${primarySource} and determines which live refinements matter.`,
  });

  let routeSource: AgentResult["routeSource"] = "live";
  let routeSourceLabel = selectedMode === "drive" ? "OSRM road route" : "TfL Journey Planner";
  let route: JourneyResult;
  log({
    kind: "fetch",
    title: `Query ${primarySource} for ${modeConfig.label.toLowerCase()}`,
    detail: selectedMode === "drive"
      ? `${from.shortName} → ${to.shortName}; request current road-network geometry.`
      : `${from.shortName} → ${to.shortName}; modes=${modeConfig.tflModes}`,
    source: selectedMode === "drive" ? "router.project-osrm.org" : "api.tfl.gov.uk/Journey",
  });
  try {
    route = await providers.getJourney(from, to, selectedMode);
    sources.push({ name: primarySource, role: "Core route and geometry", state: "live" });
    log({
      kind: "success",
      title: "Core route learned and cached",
      detail: `${route.legs.length} legs, ${route.duration} minutes and ${route.path.length} route points. Saved as core-route:v2.`,
      source: primarySource,
    });
  } catch (error) {
    rememberFailure(primarySource);
    sources.push({ name: primarySource, role: "Core route and geometry", state: "failed" });
    log({
      kind: "failure",
      title: "Primary journey source unavailable",
      detail: error instanceof Error ? error.message : `${primarySource} failed.`,
      source: primarySource,
    });
    recoveryState.action = selectedMode === "drive" ? "skip" : "substitute";
    if (selectedMode === "drive") {
      route = fallbackJourney(from, to, selectedMode);
      routeSource = "fallback";
      routeSourceLabel = "Local driving estimate";
      sources.push({ name: "Local road estimate", role: "Last-resort driving route", state: "fallback" });
      log({
        kind: "recovery",
        title: "Do not repeat OSRM — use local driving estimate",
        detail: "The failed road source is not retried. A transparent direct estimate keeps traffic checks usable.",
        source: "Local fallback",
      });
    } else {
      log({
        kind: "decision",
        title: "Substitute an independent no-key road source",
        detail: "Do not repeat the failed TfL request. OSRM can provide an honest walking/cycling road contingency, not a fake transit schedule.",
        source: "OSRM/OpenStreetMap",
      });
      try {
        route = await providers.getBackupJourney(from, to, selectedMode);
        routeSource = "backup";
        routeSourceLabel = route.legs.every((leg) => leg.mode === "Walk")
          ? "OSRM walking contingency"
          : "OSRM road-network backup";
        sources.push({ name: "OSRM/OpenStreetMap", role: "Independent road contingency", state: "backup" });
        log({
          kind: "recovery",
          title: "Core route recovered from independent backup",
          detail: "A clearly labelled road-based contingency was cached without pretending to contain live transit schedules.",
          source: "OSRM/OpenStreetMap",
        });
      } catch {
        route = fallbackJourney(from, to, selectedMode);
        routeSource = "fallback";
        routeSourceLabel = "Built-in London network snapshot";
        sources.push({ name: "Local network snapshot", role: "Last-resort route", state: "fallback" });
        log({
          kind: "recovery",
          title: "Backup unavailable — use labelled local snapshot",
          detail: `A usable ${route.legs.length}-leg contingency was cached and live refinements can continue.`,
          source: "Local fallback",
        });
      }
    }
  }
  cache.set("core-route:v2", route);

  const walkingMinutes = route.legs
    .filter((leg) => leg.mode === "Walk")
    .reduce((sum, leg) => sum + leg.minutes, 0);
  const midpoint = {
    lat: Number(((from.lat + to.lat) / 2).toFixed(5)),
    lng: Number(((from.lng + to.lng) / 2).toFixed(5)),
  };

  let mobility: MobilityContext = fallbackMobility(selectedMode);
  if (selectedMode === "walking" || selectedMode === "drive") {
    mobility = {
      label: selectedMode === "drive" ? "Road monitoring" : "Live vehicle feed",
      value: selectedMode === "drive" ? "Active" : "Not needed",
      note: selectedMode === "drive"
        ? "Route-local TfL road alerts are monitored and refreshed separately."
        : "This journey is fully on foot, so vehicle arrivals would not improve it.",
      sourceMode: "fallback",
      updatedAt: null,
    };
    log({
      kind: "decision",
      title: selectedMode === "drive" ? "Driving selected — prioritise route traffic" : "Skip vehicle data for a walking-only route",
      detail: selectedMode === "drive"
        ? "Live arrivals do not apply. Spend the next request on road disruptions along the learned geometry."
        : "Live arrivals and cycle-dock data cannot improve this journey.",
    });
  } else {
    const mobilitySource = selectedMode === "cycling" ? "TfL Cycle Hire" : "TfL Live Arrivals";
    log({
      kind: "decision",
      title: `Selected mode makes ${mobilitySource} useful`,
      detail: selectedMode === "cycling"
        ? "Check the nearest Santander Cycles docking point before broader risk data."
        : "Use the learned first transit stop to request the next relevant service.",
    });
    log({
      kind: "fetch",
      title: `Query ${mobilitySource}`,
      detail: "This source was selected only after the route and preferred mode were known.",
      source: "api.tfl.gov.uk",
    });
    try {
      mobility = await providers.getMobilityContext(from, route.legs, selectedMode);
      if (mobility.sourceMode === "live") {
        cache.set("mobility-context:v1", mobility);
        sources.push({ name: mobility.sourceName ?? mobilitySource, role: "Mode-specific live context", state: "live" });
        log({
          kind: "success",
          title: "Mode-specific context added",
          detail: mobility.note,
          source: mobility.sourceName ?? mobilitySource,
        });
      } else {
        log({ kind: "recovery", title: "No live stop identifier — continue", detail: mobility.note, reused: true });
      }
    } catch (error) {
      rememberFailure(mobilitySource);
      rememberCache("core-route:v2");
      if (recoveryState.action === "none") recoveryState.action = "skip";
      sources.push({ name: mobilitySource, role: "Mode-specific live context", state: "failed" });
      log({
        kind: "failure",
        title: "Mode-specific live feed unavailable",
        detail: error instanceof Error ? error.message : `${mobilitySource} failed.`,
        source: mobilitySource,
      });
      log({
        kind: "recovery",
        title: "Skip the refinement, retain the route",
        detail: "Arrival or bike availability affects convenience, not route validity. core-route:v2 is reused.",
        reused: true,
      });
    }
  }

  const roadPriority = selectedMode === "drive" || selectedMode === "bus";
  const safetyFirst = !roadPriority && walkingMinutes >= 6;
  log({
    kind: "decision",
    title: roadPriority
      ? `${modeConfig.label} is road-exposed — check route traffic next`
      : safetyFirst
        ? "Walking exposure found — check published safety context next"
        : "Low walking exposure — check disruption next",
    detail: roadPriority
      ? "Road disruptions can directly change this journey, so they outrank historic safety context."
      : safetyFirst
        ? `${walkingMinutes} walking minutes makes published location context the more useful next refinement.`
        : `Only ${walkingMinutes} walking minutes; current disruption has greater information value.`,
  });

  let safety: SafetyContext = fallbackSafety();
  let traffic: TrafficContext = fallbackTraffic(route.legs);

  const runSafety = async () => {
    log({
      kind: "fetch",
      title: "Query latest published Police.uk context",
      detail: "Use the journey midpoint, newest published month and calculate its age explicitly.",
      source: "data.police.uk",
    });
    try {
      safety = await providers.getSafety(midpoint);
      cache.set("safety-context:v1", safety);
      sources.push({ name: "Police.uk", role: "Historic published safety context", state: "published" });
      log({
        kind: "success",
        title: "Published safety context learned and cached",
        detail: `${safety.incidents ?? 0} records for ${safety.month}; publication age ${safety.publishedAgeMonths} month(s).`,
        source: "Police.uk",
      });
    } catch (error) {
      rememberFailure("Police.uk");
      rememberCache("core-route:v2");
      if (recoveryState.action === "none") recoveryState.action = "skip";
      sources.push({ name: "Police.uk", role: "Historic published safety context", state: "failed" });
      log({
        kind: "failure",
        title: "Published safety source unavailable",
        detail: error instanceof Error ? error.message : "Police.uk failed.",
        source: "Police.uk",
      });
      log({
        kind: "recovery",
        title: "Proceed with an explicit safety caveat",
        detail: "Historic context does not invalidate the cached route, so no completed step is replayed.",
        reused: true,
      });
    }
  };

  const runTraffic = async () => {
    log({
      kind: "decision",
      title: "Route geometry is cached — check local delay risk",
      detail: "Filter live TfL road records against this route instead of reporting a London-wide count.",
    });
    log({
      kind: "fetch",
      title: "Query TfL Road Disruptions",
      detail: request.injectFailure
        ? "Demo mode will inject HTTP 503 at this point."
        : `Check active disruptions near ${route.path.length} learned route points.`,
      source: "api.tfl.gov.uk/Road",
    });
    try {
      traffic = await providers.getTraffic(Boolean(request.injectFailure), route.path, selectedMode);
      cache.set("traffic-context:v2", traffic);
      sources.push({ name: "TfL Road Disruptions", role: "Route-local traffic risk", state: "live" });
      log({
        kind: "success",
        title: "Route-local traffic context added",
        detail: traffic.note,
        source: "TfL Road Disruptions",
      });
    } catch (error) {
      rememberFailure("TfL Road Disruptions");
      sources.push({ name: "TfL Road Disruptions", role: "Route-local traffic risk", state: "failed" });
      const sourceError = error instanceof DataSourceError ? error : null;
      log({
        kind: "failure",
        title: "Road source failed mid-plan",
        detail: sourceError?.code === "INJECTED"
          ? "HTTP 503 injected for demonstration."
          : error instanceof Error ? error.message : "TfL Road Disruptions failed.",
        source: "TfL Road Disruptions",
      });
      rememberCache("core-route:v2");
      rememberCache("mobility-context:v1");
      rememberCache("safety-context:v1");

      if (selectedMode === "drive") {
        traffic = fallbackTraffic(route.legs);
        recoveryState.action = "skip";
        log({
          kind: "decision",
          title: "No equivalent no-key live traffic substitute — skip",
          detail: "A rail-status proxy would mislead a driver. Keep the cached road route and mark traffic unknown.",
          reused: true,
        });
        log({
          kind: "recovery",
          title: "Driving route retained with explicit warning",
          detail: "The road route remains usable, but the driver is told to recheck traffic before departure.",
          reused: true,
        });
        return;
      }

      recoveryState.action = "substitute";
      log({
        kind: "decision",
        title: "Do not retry; substitute a narrower transit signal",
        detail: "Reuse completed results and query TfL Line Status as a delay proxy for the transport legs.",
        reused: true,
      });
      try {
        traffic = await providers.getLineStatus(route.legs);
        sources.push({ name: "TfL Line Status", role: "Delay-risk substitute", state: "substitute" });
        log({
          kind: "recovery",
          title: "Recovered with no replay",
          detail: `Reused ${recoveryState.cachedItemsReused.join(" + ")} and added line status. Zero completed fetches rerun.`,
          source: "TfL Line Status",
          reused: true,
        });
      } catch {
        traffic = fallbackTraffic(route.legs);
        recoveryState.action = "skip";
        log({
          kind: "recovery",
          title: "Substitute also unavailable — finish with caveat",
          detail: "The cached multi-leg route remains usable; live delay confidence is marked unknown.",
          reused: true,
        });
      }
    }
  };

  if (safetyFirst) {
    await runSafety();
    await runTraffic();
  } else {
    await runTraffic();
    await runSafety();
  }

  log({
    kind: "decision",
    title: "Combine evidence and enable live refresh",
    detail: "Keep coherent legs, attach uncertainty only to affected data, then refresh live arrivals and route-local traffic every 60 seconds without rerunning the core route.",
    reused: recoveryState.occurred,
  });

  const transportLegs = route.legs.filter((leg) => leg.mode !== "Walk");
  const changes = Math.max(0, transportLegs.length - 1);
  const confidence = routeSource === "live" && traffic.sourceMode !== "unavailable" ? "High" : "Medium";
  const failedSource = failedSources.length ? failedSources.join(", ") : null;

  return {
    requestId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    from: from.name,
    to: to.name,
    selectedMode,
    selectedModeLabel: modeConfig.label,
    durationMinutes: Math.round(route.duration),
    walkingMinutes,
    changes,
    confidence,
    routeSource,
    routeSourceLabel,
    routePath: route.path,
    legs: route.legs,
    decisions,
    safety,
    traffic,
    mobility,
    liveRefreshSeconds: 60,
    recovery: {
      occurred: recoveryState.occurred,
      failedSource,
      action: recoveryState.action,
      cachedItemsReused: recoveryState.cachedItemsReused,
      completedStepsReplayed: 0,
      message: recoveryState.occurred
        ? `Recovered after ${failedSource} failed by reusing completed work and choosing ${recoveryState.action}.`
        : "All selected live checks completed without recovery.",
    },
    sources,
  };
}
