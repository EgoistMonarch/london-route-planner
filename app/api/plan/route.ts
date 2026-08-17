import { planRoute } from "../../lib/route-agent";
import {
  isLocationKey,
  isTransportMode,
  type TransportMode,
} from "../../lib/route-config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      from?: unknown;
      to?: unknown;
      mode?: TransportMode;
      injectFailure?: boolean;
    };

    if (
      !isLocationKey(body.from) ||
      !isLocationKey(body.to) ||
      !isTransportMode(body.mode) ||
      body.from === body.to
    ) {
      return Response.json(
        { error: "Choose two different supported London locations." },
        { status: 400 },
      );
    }

    const result = await planRoute({
      from: body.from,
      to: body.to,
      mode: body.mode,
      injectFailure: Boolean(body.injectFailure),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Route planning failed." },
      { status: 500 },
    );
  }
}
