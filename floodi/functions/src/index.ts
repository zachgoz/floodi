import { onRequest } from "firebase-functions/v2/https";
import fetch from "node-fetch";

/**
 * CORS proxy for the Sunny Day Flooding (FiMAN) API.
 *
 * The FiMAN API at data.sunnydayflooding.com does not set
 * Access-Control-Allow-Origin headers, so browser requests from our
 * Firebase Hosting domain are blocked.  This function forwards
 * whitelisted requests and injects the appropriate CORS headers.
 *
 * Usage:  GET /fimanProxy?<same params as data.sunnydayflooding.com>
 */

const FIMAN_BASE = "https://data.sunnydayflooding.com/services/data.php";

export const fimanProxy = onRequest({ cors: true, maxInstances: 10 }, async (req, res) => {
  // Manual CORS check for specific allowed origins if needed, 
  // but v2 { cors: true } handles the basics.

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Forward query params to the FiMAN API
  const params = new URLSearchParams(
    req.query as Record<string, string>
  ).toString();
  const url = `${FIMAN_BASE}?${params}`;

  try {
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      res
        .status(upstream.status)
        .json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    const data = await upstream.json();

    // Cache for 5 minutes at CDN level, 1 minute in browser
    res.set("Cache-Control", "public, s-maxage=300, max-age=60");
    res.status(200).json(data);
  } catch (err) {
    console.error("FiMAN proxy error:", err);
    res.status(502).json({ error: "Failed to fetch from FiMAN API" });
  }
});

export { syncWaterLevels, syncPredictions } from "./syncData";
export { runBackfillData } from "./backfill";
export { syncImagery } from "./syncImagery";
