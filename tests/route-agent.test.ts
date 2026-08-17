import assert from "node:assert/strict";
import test from "node:test";
import {
  DataSourceError,
  distanceToRouteKm,
  planRoute,
  refreshLiveData,
  type AgentProviders,
  type JourneyResult,
} from "../app/lib/route-agent";

const highWalkingRoute: JourneyResult = {
  duration: 24,
  path: [{ lat: 51.5308, lng: -0.1238 }, { lat: 51.4815, lng: -0.0094 }],
  legs: [
    { mode: "Walk", line: "On foot", from: "Origin", to: "Station", minutes: 8, instruction: "Walk to the station" },
    { mode: "Tube", line: "Northern line", from: "Station", to: "Destination", minutes: 16, instruction: "Take the train", departureStopId: "mock-stop", lineId: "northern" },
  ],
};

const lowWalkingRoute: JourneyResult = {
  duration: 15,
  path: [{ lat: 51.5154, lng: -0.1755 }, { lat: 51.5133, lng: -0.089 }],
  legs: [
    { mode: "Walk", line: "On foot", from: "Origin", to: "Stop", minutes: 2, instruction: "Walk to the stop" },
    { mode: "Bus", line: "Route 1", from: "Stop", to: "Destination", minutes: 13, instruction: "Take the bus", departureStopId: "mock-stop", lineId: "1" },
  ],
};

function providers(calls: string[], overrides: Partial<AgentProviders> = {}): AgentProviders {
  return {
    getJourney: async () => {
      calls.push("journey");
      return highWalkingRoute;
    },
    getBackupJourney: async () => {
      calls.push("backup");
      return highWalkingRoute;
    },
    getMobilityContext: async () => {
      calls.push("mobility");
      return { label: "Next live service", value: "3 min", note: "Mock live arrival.", sourceMode: "live", sourceName: "Mock Arrivals", updatedAt: "2026-08-17T12:00:00.000Z" };
    },
    getSafety: async () => {
      calls.push("safety");
      return { level: "Typical", incidents: 6, month: "2026-06", publishedAgeMonths: 2, note: "Mock published safety context.", sourceMode: "published" };
    },
    getTraffic: async () => {
      calls.push("traffic");
      return { level: "Low", disruptions: 0, note: "Mock route-local traffic context.", sourceMode: "live", scope: "route", updatedAt: "2026-08-17T12:00:00.000Z", alerts: [] };
    },
    getLineStatus: async () => {
      calls.push("line-status");
      return { level: "Low", disruptions: 0, note: "Mock line-status substitute.", sourceMode: "substitute", scope: "network", updatedAt: "2026-08-17T12:00:00.000Z", alerts: [] };
    },
    ...overrides,
  };
}

test("reuses cached route and safety data when traffic fails mid-execution", async () => {
  const calls: string[] = [];
  const mockProviders = providers(calls, {
    getTraffic: async () => {
      calls.push("traffic");
      throw new DataSourceError("Injected 503", "TfL Road Disruptions", "INJECTED");
    },
  });

  const result = await planRoute(
    { from: "kings-cross", to: "greenwich", mode: "recommended", injectFailure: true },
    mockProviders,
  );

  assert.deepEqual(calls, ["journey", "mobility", "safety", "traffic", "line-status"]);
  assert.equal(result.recovery.occurred, true);
  assert.equal(result.recovery.action, "substitute");
  assert.equal(result.recovery.completedStepsReplayed, 0);
  assert.deepEqual(result.recovery.cachedItemsReused, ["core-route:v2", "mobility-context:v1", "safety-context:v1"]);
  assert.equal(result.traffic.sourceMode, "substitute");
  assert.ok(result.legs.length > 0);
});

test("changes the next-source order after learning walking exposure", async () => {
  const calls: string[] = [];
  const mockProviders = providers(calls, {
    getJourney: async () => {
      calls.push("journey");
      return lowWalkingRoute;
    },
  });

  const result = await planRoute(
    { from: "paddington", to: "bank", mode: "recommended", injectFailure: false },
    mockProviders,
  );

  assert.deepEqual(calls, ["journey", "mobility", "traffic", "safety"]);
  assert.equal(result.recovery.occurred, false);
  assert.ok(result.decisions.some((event) => event.title.includes("Low walking exposure")));
});

test("substitutes OSRM backup once when the primary journey source fails", async () => {
  const calls: string[] = [];
  const mockProviders = providers(calls, {
    getJourney: async () => {
      calls.push("journey");
      throw new DataSourceError("TfL timeout", "TfL Journey Planner", "TIMEOUT");
    },
    getBackupJourney: async () => {
      calls.push("backup");
      return highWalkingRoute;
    },
  });

  const result = await planRoute(
    { from: "victoria", to: "canary-wharf", mode: "rail", injectFailure: false },
    mockProviders,
  );

  assert.equal(calls.filter((call) => call === "journey").length, 1);
  assert.equal(calls.filter((call) => call === "backup").length, 1);
  assert.equal(result.routeSource, "backup");
  assert.equal(result.recovery.action, "substitute");
  assert.equal(result.recovery.completedStepsReplayed, 0);
  assert.ok(result.legs.length > 0);
});

test("skips only delay refinement when both traffic and substitute fail", async () => {
  const calls: string[] = [];
  const mockProviders = providers(calls, {
    getTraffic: async () => {
      calls.push("traffic");
      throw new DataSourceError("Road timeout", "TfL Road Disruptions", "TIMEOUT");
    },
    getLineStatus: async () => {
      calls.push("line-status");
      throw new DataSourceError("Line timeout", "TfL Line Status", "TIMEOUT");
    },
  });

  const result = await planRoute(
    { from: "camden-town", to: "london-bridge", mode: "recommended", injectFailure: false },
    mockProviders,
  );

  assert.equal(result.recovery.action, "skip");
  assert.equal(result.traffic.sourceMode, "unavailable");
  assert.equal(result.recovery.completedStepsReplayed, 0);
  assert.ok(result.legs.length > 0);
  assert.ok(result.decisions.some((event) => event.title.includes("finish with caveat")));
});

test("driving mode prioritises route-local road data and skips irrelevant arrivals", async () => {
  const calls: string[] = [];
  const result = await planRoute(
    { from: "victoria", to: "canary-wharf", mode: "drive", injectFailure: false },
    providers(calls),
  );

  assert.deepEqual(calls, ["journey", "traffic", "safety"]);
  assert.equal(result.selectedMode, "drive");
  assert.equal(result.traffic.scope, "route");
  assert.ok(result.decisions.some((event) => event.title.includes("road-exposed")));
});

test("live refresh retains cached traffic when that source fails without rerunning the route", async () => {
  const calls: string[] = [];
  const mockProviders = providers(calls, {
    getTraffic: async () => {
      calls.push("traffic");
      throw new DataSourceError("Road timeout", "TfL Road Disruptions", "TIMEOUT");
    },
  });

  const refreshed = await refreshLiveData({
    from: "kings-cross",
    mode: "bus",
    legs: lowWalkingRoute.legs,
    routePath: lowWalkingRoute.path,
  }, mockProviders);

  assert.deepEqual(calls, ["traffic", "mobility"]);
  assert.equal(refreshed.status, "partial");
  assert.deepEqual(refreshed.retained, ["traffic"]);
  assert.equal(refreshed.traffic, undefined);
  assert.ok(refreshed.mobility);
});

test("road warnings are filtered by distance from learned route geometry", () => {
  const route = [{ lat: 51.5, lng: -0.15 }, { lat: 51.5, lng: -0.05 }];
  assert.ok(distanceToRouteKm({ lat: 51.501, lng: -0.1 }, route) < 0.2);
  assert.ok(distanceToRouteKm({ lat: 51.55, lng: -0.1 }, route) > 5);
});
