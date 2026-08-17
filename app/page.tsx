"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentResult,
  DecisionEvent,
  LiveRefreshResult,
} from "./lib/route-agent";
import {
  LOCATION_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  type LocationKey,
  type TransportMode,
} from "./lib/route-config";

const modeSymbol: Record<string, string> = {
  Walk: "W",
  Tube: "U",
  Rail: "R",
  Bus: "B",
  DLR: "D",
  Cycle: "C",
  Overground: "O",
  "Elizabeth line": "E",
  Drive: "D",
};

function StatusPill({ state }: { state: string }) {
  const label = state === "substitute" ? "Substitute" : state[0].toUpperCase() + state.slice(1);
  return <span className={`source-state ${state}`}>{label}</span>;
}

function DecisionRow({ event, visible }: { event: DecisionEvent; visible: boolean }) {
  return (
    <li className={`decision-row ${event.kind} ${visible ? "is-visible" : ""}`}>
      <div className="decision-marker">
        {event.kind === "failure" ? "!" : event.kind === "success" || event.kind === "recovery" ? "✓" : event.id}
      </div>
      <div>
        <div className="decision-meta">
          <span>{event.kind}</span>
          {event.reused && <span className="cache-tag">cache reused</span>}
        </div>
        <h4>{event.title}</h4>
        <p>{event.detail}</p>
      </div>
    </li>
  );
}

function AppHeader({ onNewJourney, showBack = false }: { onNewJourney?: () => void; showBack?: boolean }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onNewJourney} aria-label="Wayfinder journey planner">
        <span className="brand-mark">W</span>
        <span>WAYFINDER<span className="brand-dot">/</span>LONDON</span>
      </button>
      <div className="topbar-actions">
        <div className="live-label"><span className="pulse-dot" /> Live updates connected</div>
        {showBack && <button className="new-journey" onClick={onNewJourney}>← New journey</button>}
      </div>
    </header>
  );
}

export default function Home() {
  const [from, setFrom] = useState<LocationKey>("kings-cross");
  const [to, setTo] = useState<LocationKey>("greenwich");
  const [mode, setMode] = useState<TransportMode>("recommended");
  const [injectFailure, setInjectFailure] = useState(true);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [visibleEvents, setVisibleEvents] = useState(0);
  const [liveTraffic, setLiveTraffic] = useState<AgentResult["traffic"] | null>(null);
  const [liveMobility, setLiveMobility] = useState<AgentResult["mobility"] | null>(null);
  const [lastLiveRefresh, setLastLiveRefresh] = useState<string | null>(null);
  const [liveRefreshStatus, setLiveRefreshStatus] = useState<LiveRefreshResult["status"]>("fresh");
  const [liveRefreshMessage, setLiveRefreshMessage] = useState("Live data loaded with this plan.");
  const [refreshing, setRefreshing] = useState(false);

  const refreshLive = useCallback(async (snapshot: AgentResult) => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          mode: snapshot.selectedMode,
          legs: snapshot.legs,
          routePath: snapshot.routePath,
        }),
      });
      const payload = (await response.json()) as LiveRefreshResult | { error?: string };
      if (!response.ok || !("status" in payload)) {
        throw new Error("error" in payload ? payload.error || "Live refresh failed." : "Live refresh failed.");
      }
      if (payload.traffic) setLiveTraffic(payload.traffic);
      if (payload.mobility) setLiveMobility(payload.mobility);
      setLastLiveRefresh(payload.generatedAt);
      setLiveRefreshStatus(payload.status);
      setLiveRefreshMessage(payload.message);
    } catch {
      setLiveRefreshStatus("cached");
      setLiveRefreshMessage("Live refresh failed; previously displayed data was retained.");
    } finally {
      setRefreshing(false);
    }
  }, [from]);

  useEffect(() => {
    if (!result) return;
    const timer = window.setInterval(() => {
      setVisibleEvents((count) => {
        if (count >= result.decisions.length) {
          window.clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, 160);
    return () => window.clearInterval(timer);
  }, [result]);

  useEffect(() => {
    if (!result) return;
    const timer = window.setInterval(
      () => void refreshLive(result),
      result.liveRefreshSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [refreshLive, result]);

  const arrivalTime = useMemo(() => {
    if (!result) return "—";
    const arrival = new Date(new Date(result.generatedAt).getTime() + result.durationMinutes * 60_000);
    return arrival.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }, [result]);

  async function plan() {
    setLoading(true);
    setError("");
    setResult(null);
    setVisibleEvents(0);
    setLiveTraffic(null);
    setLiveMobility(null);
    setLastLiveRefresh(null);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, mode, injectFailure }),
      });
      const payload = (await response.json()) as AgentResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload ? payload.error || "Could not plan this route." : "Could not plan this route.");
      }
      const plannedRoute = payload as AgentResult;
      const mobilityIsRelevant = plannedRoute.selectedMode !== "drive" && plannedRoute.selectedMode !== "walking";
      const initialLiveChecks = [
        plannedRoute.traffic.sourceMode === "live",
        mobilityIsRelevant ? plannedRoute.mobility.sourceMode === "live" : true,
      ];
      const initialLiveStatus: LiveRefreshResult["status"] = initialLiveChecks.every(Boolean)
        ? "fresh"
        : initialLiveChecks.some(Boolean)
          ? "partial"
          : "cached";
      setResult(plannedRoute);
      setLastLiveRefresh(plannedRoute.generatedAt);
      setLiveRefreshStatus(initialLiveStatus);
      setLiveRefreshMessage(initialLiveStatus === "fresh"
        ? "Live data loaded with this plan."
        : "Some live sources were unavailable; substituted or cached context is shown.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (routeError) {
      setError(routeError instanceof Error ? routeError.message : "Could not plan this route.");
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    setFrom(to);
    setTo(from);
    setResult(null);
  }

  function newJourney() {
    setResult(null);
    setVisibleEvents(0);
    setError("");
    setLiveTraffic(null);
    setLiveMobility(null);
    setLastLiveRefresh(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!result) {
    return (
      <main className="app-shell selection-shell">
        <AppHeader onNewJourney={newJourney} />
        <section className="selection-screen">
          <div className="selection-copy">
            <p className="eyebrow">Resilient route intelligence</p>
            <h1>Plan London.<br /><span>Outrun bad data.</span></h1>
            <p className="intro">
              A journey agent that learns, adapts and keeps moving when live transport sources fail.
            </p>
            <div className="capability-row">
              <div><b>01</b><span>Adaptive decisions</span></div>
              <div><b>02</b><span>Cached progress</span></div>
              <div><b>03</b><span>Failure recovery</span></div>
            </div>
          </div>

          <div className="planner-panel">
            <div className="panel-topline">
              <div><span>01 / Journey</span><h2>Choose your route</h2></div>
              <span className="agent-ready"><i /> Agent ready</span>
            </div>

            <div className="location-stack">
              <label className="location-field">
                <span className="field-index">A</span>
                <span className="field-label">Starting point</span>
                <select value={from} onChange={(event) => setFrom(event.target.value as LocationKey)}>
                  {LOCATION_OPTIONS.map((location) => <option key={location.key} value={location.key}>{location.name}</option>)}
                </select>
              </label>
              <button className="swap-button" onClick={swap} aria-label="Swap origin and destination">⇅</button>
              <label className="location-field">
                <span className="field-index destination">B</span>
                <span className="field-label">Destination</span>
                <select value={to} onChange={(event) => setTo(event.target.value as LocationKey)}>
                  {LOCATION_OPTIONS.map((location) => <option key={location.key} value={location.key}>{location.name}</option>)}
                </select>
              </label>
            </div>

            <fieldset className="mode-picker">
              <legend>Preferred transport</legend>
              <div>
                {TRANSPORT_MODE_OPTIONS.map((option) => (
                  <label key={option.key} className={mode === option.key ? "is-selected" : ""}>
                    <input
                      type="radio"
                      name="transport-mode"
                      value={option.key}
                      checked={mode === option.key}
                      onChange={() => setMode(option.key)}
                    />
                    <span className="mode-choice-symbol">{option.symbol}</span>
                    <strong>{option.label}</strong>
                    <small>{option.shortLabel}</small>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="failure-toggle">
              <span className="failure-copy">
                <strong>Demonstrate recovery</strong>
                <small>Inject a TfL Road API failure during planning</small>
              </span>
              <input type="checkbox" checked={injectFailure} onChange={(event) => setInjectFailure(event.target.checked)} />
              <span className="toggle-track"><span /></span>
            </label>

            <button className="plan-button" onClick={plan} disabled={loading || from === to}>
              {loading ? <><span className="spinner" /> Building resilient route…</> : <>Build route <span>↗</span></>}
            </button>
            {from === to && <p className="form-error">Choose a different destination.</p>}
            {error && <p className="form-error">{error}</p>}
          </div>
        </section>

        <div className="selection-footer">
          <span>TRANSPORT</span><i /> <span>TRAFFIC</span><i /> <span>SAFETY</span>
          <p>Free public APIs · No completed step is replayed</p>
        </div>

        {loading && (
          <div className="loading-screen" aria-live="polite">
            <div className="loading-ring"><span /></div>
            <p>AGENT WORKING</p>
            <h2>Choosing the next best source</h2>
            <span>Every successful step is being cached.</span>
          </div>
        )}
      </main>
    );
  }

  const displayedTraffic = liveTraffic ?? result.traffic;
  const displayedMobility = liveMobility ?? result.mobility;
  const roadWarningVisible = result.selectedMode === "bus" || result.selectedMode === "drive";
  const roadWarningTone = displayedTraffic.level === "High"
    ? "high"
    : displayedTraffic.level === "Moderate"
      ? "moderate"
      : displayedTraffic.level === "Unknown"
        ? "unknown"
        : "low";

  return (
    <main className="app-shell result-shell">
      <AppHeader onNewJourney={newJourney} showBack />

      <section className="results-screen" aria-live="polite">
        <div className="results-titlebar">
          <div>
            <p className="eyebrow">Route secured</p>
            <h1>{result.from} <span>→</span> {result.to}</h1>
          </div>
          <div className="planned-at">Planned at {new Date(result.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
        </div>

        <div className={`live-refresh-bar ${liveRefreshStatus}`}>
          <div>
            <span className="pulse-dot" />
            <strong>
              {liveRefreshStatus === "cached"
                ? "Cached live context retained"
                : liveRefreshStatus === "partial"
                  ? "Partial live context"
                  : "Live context active"}
            </strong>
            <small>
              {lastLiveRefresh
                ? `Updated ${new Date(lastLiveRefresh).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                : "Waiting for first update"}
              {` · Auto-refresh ${result.liveRefreshSeconds}s`}
            </small>
          </div>
          <span>{liveRefreshMessage}</span>
          <button onClick={() => void refreshLive(result)} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh now"}
          </button>
        </div>

        <div className="summary-strip">
          <div><span>Journey</span><strong>{result.durationMinutes}<small> min</small></strong></div>
          <div><span>Arrival</span><strong>{arrivalTime}</strong></div>
          <div><span>Changes</span><strong>{result.changes}</strong></div>
          <div><span>Walk</span><strong>{result.walkingMinutes}<small> min</small></strong></div>
          <div><span>Mode</span><strong className="mode-summary">{result.selectedModeLabel}</strong></div>
          <div><span>Confidence</span><strong className="confidence">{result.confidence}</strong></div>
        </div>

        {result.recovery.occurred && (
          <div className="recovery-banner">
            <div className="recovery-icon">↻</div>
            <div>
              <span>Recovered mid-execution</span>
              <strong>{result.recovery.failedSource} failed. Completed work was retained.</strong>
              <p>{result.recovery.cachedItemsReused.length} cached result{result.recovery.cachedItemsReused.length === 1 ? "" : "s"} reused · {result.recovery.completedStepsReplayed} completed steps replayed · final route remains usable</p>
            </div>
            <span className="recovery-state">Recovered</span>
          </div>
        )}

        {roadWarningVisible && (
          <section className={`traffic-warning ${roadWarningTone}`}>
            <div className="traffic-warning-heading">
              <span>!</span>
              <div>
                <small>{result.selectedMode === "drive" ? "Driving road warning" : "Bus traffic warning"}</small>
                <h2>{displayedTraffic.level} route disruption risk</h2>
                <p>{displayedTraffic.note}</p>
              </div>
              <StatusPill state={displayedTraffic.sourceMode} />
            </div>
            {displayedTraffic.alerts.length > 0 && (
              <ul>
                {displayedTraffic.alerts.slice(0, 3).map((alert) => (
                  <li key={alert.id}>
                    <strong>{alert.severity}: {alert.title}</strong>
                    <span>{alert.distanceKm.toFixed(1)} km from route · {alert.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="results-grid">
          <article className="route-panel">
            <div className="section-heading">
              <div><span>Route / 01</span><h2>Your journey</h2></div>
              <div className="route-source"><i className={result.routeSource === "live" ? "live-dot" : "fallback-dot"} /> {result.routeSourceLabel}</div>
            </div>
            <ol className="legs">
              {result.legs.map((leg, index) => (
                <li key={`${leg.from}-${leg.to}-${index}`}>
                  <div className={`mode-icon mode-${leg.mode.toLowerCase().replaceAll(" ", "-")}`}>{modeSymbol[leg.mode] || "T"}</div>
                  <div className="leg-line" />
                  <div className="leg-content">
                    <div><span className="leg-mode">{leg.mode} · {leg.line}</span><span className="leg-time">{leg.minutes} min</span></div>
                    <h3>{leg.from} <span>→</span> {leg.to}</h3>
                    <p>{leg.instruction}</p>
                  </div>
                </li>
              ))}
            </ol>
          </article>

          <aside className="intelligence-column">
            <div className="core-cards">
              <article className="core-card">
                <div><span>Published safety context</span><StatusPill state={result.safety.sourceMode} /></div>
                <strong>{result.safety.level}</strong>
                <p>{result.safety.note}</p>
              </article>
              <article className="core-card">
                <div><span>Route-local delay risk</span><StatusPill state={displayedTraffic.sourceMode} /></div>
                <strong>{displayedTraffic.level}</strong>
                <p>{displayedTraffic.note}</p>
              </article>
              <article className="core-card">
                <div><span>{displayedMobility.label}</span><StatusPill state={displayedMobility.sourceMode} /></div>
                <strong>{displayedMobility.value}</strong>
                <p>{displayedMobility.note}</p>
              </article>
            </div>

            <div className="agent-panel">
              <div className="section-heading">
                <div><span>Agent / 02</span><h2>Decision log</h2></div>
                <span className="event-count">{result.decisions.length} events</span>
              </div>
              <ol className="decision-log">
                {result.decisions.map((event, index) => <DecisionRow key={event.id} event={event} visible={index < visibleEvents} />)}
              </ol>
            </div>
          </aside>
        </div>

        <div className="source-rail">
          <div><span>Sources consulted</span><strong>{result.sources.length}</strong></div>
          {result.sources.map((source) => (
            <div className="source-item" key={`${source.name}-${source.state}`}>
              <span>{source.name}</span>
              <small>{source.role}</small>
              <StatusPill state={source.state} />
            </div>
          ))}
        </div>

        <div className="responsible-note">
          <strong>Journey support, not a safety guarantee.</strong>
          <span>Police data uses approximate anonymised locations and publication lags. Follow official travel advice and your surroundings.</span>
        </div>
      </section>
    </main>
  );
}
