import * as functions from "firebase-functions";
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

/**
 * Allowed origins — only needed if the function is ever called directly
 * (not through the Firebase Hosting rewrite, which is same-origin).
 */
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://floodcastwebapp.web.app",
  "https://floodcastwebapp.firebaseapp.com",
]);

function setCorsHeaders(req: functions.https.Request, res: import("express").Response) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Max-Age", "3600");
  }
}

export const fimanProxy = functions.https.onRequest(async (req, res) => {
  setCorsHeaders(req, res);

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
