import {
  refreshLiveData,
  type GeoPoint,
  type RouteLeg,
} from "../../lib/route-agent";
import {
  isLocationKey,
  isTransportMode,
  type TransportMode,
} from "../../lib/route-config";

export const dynamic = "force-dynamic";

function isRouteLeg(value: unknown): value is RouteLeg {
  if (!value || typeof value !== "object") return false;
  const leg = value as Record<string, unknown>;
  return ["mode", "line", "from", "to", "instruction"].every(
    (key) => typeof leg[key] === "string" && (leg[key] as string).length <= 300,
  ) && typeof leg.minutes === "number" && Number.isFinite(leg.minutes);
}

function isGeoPoint(value: unknown): value is GeoPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return typeof point.lat === "number" && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    typeof point.lng === "number" && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      from?: unknown;
      mode?: TransportMode;
      legs?: unknown;
      routePath?: unknown;
    };

    if (
      !isLocationKey(body.from) ||
      !isTransportMode(body.mode) ||
      !Array.isArray(body.legs) ||
      body.legs.length === 0 ||
      body.legs.length > 30 ||
      !body.legs.every(isRouteLeg) ||
      !Array.isArray(body.routePath) ||
      body.routePath.length < 2 ||
      body.routePath.length > 400 ||
      !body.routePath.every(isGeoPoint)
    ) {
      return Response.json({ error: "Invalid live-refresh request." }, { status: 400 });
    }

    const result = await refreshLiveData({
      from: body.from,
      mode: body.mode,
      legs: body.legs,
      routePath: body.routePath,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Live refresh failed." },
      { status: 500 },
    );
  }
}
