#!/usr/bin/env node
/**
 * generateRoadElevations.mjs
 *
 * Pipeline:
 *  1. Fetch road centerlines for Carolina Beach, NC from OpenStreetMap Overpass API
 *  2. Query USGS 3DEP Elevation Point Query Service (EPQS) for each unique node
 *  3. Convert NAVD88 → MLLW using the local datum offset for NOAA station 8658163
 *  4. Write a GeoJSON FeatureCollection to public/data/carolinaBeachRoads.geojson
 *
 * Usage: node scripts/generateRoadElevations.mjs
 *
 * Elevation source: USGS 3DEP (https://epqs.nationalmap.gov)
 * Road source:      OpenStreetMap via Overpass API (https://overpass-api.de)
 *
 * Datum note:
 *   NOAA station 8658163 (Carolina Beach) reports water levels in MLLW.
 *   USGS 3DEP EPQS returns elevations in NAVD88.
 *   At this station (NOAA CO-OPS datums, 1983-2001 epoch):
 *     NAVD88 = 21.58 ft above STND
 *     MLLW   = 18.83 ft above STND
 *   Therefore: NAVD88 = MLLW + 2.75 ft  →  MLLW = NAVD88 - 2.75 ft
 *   Source: https://tidesandcurrents.noaa.gov/datums.html?id=8658163
 *
 * Hydraulic Approximations (Approximating FIMAN's Models):
 *   This script uses two heuristics to approximate hydraulically enforced, hydro-flattened LiDAR models
 *   without requiring complex fluid dynamic simulations:
 *
 *   1. Road Crown Offset (+0.5 ft): Bare-earth sampling often hits road gutters or pavement edges.
 *      We artificially add 0.5 ft to simulate the true height of the road crown, which is what FIMAN uses.
 *
 *   2. Segmenting & Virtual Bulkheads: We break every OSM road into tiny node-to-node segments.
 *      In `InundationMap.tsx`, we evaluate flooding against the `maxElevation` of the segment.
 *      If a segment drops off a 6.0 ft bulkhead into 2.8 ft water, the segment max is 6.0 ft.
 *      Water must exceed 6.0 ft to flood the segment, acting as a "virtual bulkhead" against seepage.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────
const OUT_DIR  = join(__dirname, '../public/data');
const OUT_FILE = join(OUT_DIR, 'carolinaBeachRoads.geojson');

// Bounding box: south, west, north, east  (Carolina Beach town, NC)
const BBOX = '34.018,-77.908,34.068,-77.875';

// Road types we want to show
const KEEP_HIGHWAY = new Set([
  'motorway','trunk','primary','secondary','tertiary',
  'motorway_link','trunk_link','primary_link','secondary_link','tertiary_link',
  'residential','unclassified','living_street','service',
]);

// Datum conversion: NAVD88 → MLLW at NOAA station 8658163, Carolina Beach, NC
// NOAA CO-OPS datums (1983-2001 epoch): NAVD88 = 21.58 ft above STND, MLLW = 18.83 ft above STND
// So: MLLW = NAVD88 + 2.75 ft
const NAVD88_TO_MLLW = 2.75; // feet

// Heuristic offset: Add 0.5 ft to simulate the "road crown" and approximate FIMAN's hydro-flattened models
const ROAD_CROWN_OFFSET = 0.5; // feet

const CONCURRENCY      = 30;  // parallel USGS requests
const BATCH_DELAY      = 50;  // ms between batches
const SAMPLE_EVERY_NTH = 4;   // query every Nth node along a way (reduces API calls ~4x)

// ── Overpass ─────────────────────────────────────────────────────────────────
async function fetchOSMRoads() {
  const query = `[out:json][timeout:90];(way["highway"](${BBOX}););(._;>;);out body;`;
  const url   = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  console.log('📡 Fetching road network from OpenStreetMap …');
  const res = await fetch(url, { headers: { 'User-Agent': 'FloodCast/1.0 road-elevation-generator' } });
  if (!res.ok) throw new Error(`Overpass API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── USGS EPQS ────────────────────────────────────────────────────────────────
async function queryElevation(lon, lat) {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const raw  = parseFloat(data.value);
    if (!isFinite(raw) || raw < -9999) return null; // over water / no data
    return raw + NAVD88_TO_MLLW + ROAD_CROWN_OFFSET;
  } catch {
    return null;
  }
}

async function batchQueryElevations(nodeMap) {
  const entries  = [...nodeMap.entries()];
  const results  = new Map();
  let   done     = 0;

  console.log(`🏔  Querying USGS 3DEP EPQS for ${entries.length} nodes …`);

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async ([id, { lon, lat }]) => {
      results.set(id, await queryElevation(lon, lat));
      done++;
    }));
    if (done % 50 === 0 || done === entries.length) {
      process.stdout.write(`\r  ${done}/${entries.length} (${Math.round(done / entries.length * 100)}%)   `);
    }
    if (i + CONCURRENCY < entries.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }
  console.log(); // newline after progress
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const osm = await fetchOSMRoads();

  // Build node-coordinate map
  const nodeCoords = new Map();
  for (const el of osm.elements) {
    if (el.type === 'node') nodeCoords.set(el.id, { lon: el.lon, lat: el.lat });
  }

  // Filter ways
  const ways = osm.elements.filter(el =>
    el.type === 'way' && KEEP_HIGHWAY.has(el.tags?.highway)
  );
  console.log(`✅ ${ways.length} road ways, ${nodeCoords.size} nodes total`);

  // Sample all nodes to allow highly granular segments
  const usedNodes = new Map();
  for (const way of ways) {
    const nodes = way.nodes.filter(nid => nodeCoords.has(nid));
    nodes.forEach(nid => {
      if (!usedNodes.has(nid)) usedNodes.set(nid, nodeCoords.get(nid));
    });
  }
  console.log(`   ${usedNodes.size} unique nodes referenced by road ways`);

  // Fetch elevations
  const elevations = await batchQueryElevations(usedNodes);

  // Count how many nodes got elevation data
  const found = [...elevations.values()].filter(v => v !== null).length;
  console.log(`   ${found}/${usedNodes.size} nodes have elevation data`);

  // Build GeoJSON features (one feature per road segment between two nodes)
  const features = [];
  for (const way of ways) {
    const coordsData = way.nodes
      .filter(nid => nodeCoords.has(nid))
      .map(nid => {
        const { lon, lat } = nodeCoords.get(nid);
        const elev = elevations.get(nid);
        return {
          nid,
          coords: elev !== undefined && elev !== null ? [lon, lat, elev] : [lon, lat]
        };
      });

    if (coordsData.length < 2) continue;

    // Split road into individual node-to-node segments for granular flooding
    for (let i = 0; i < coordsData.length - 1; i++) {
      const p1 = coordsData[i];
      const p2 = coordsData[i + 1];
      const segmentId = `${p1.nid}-${p2.nid}`;
      
      const segElevs = [];
      if (p1.coords.length === 3) segElevs.push(p1.coords[2]);
      if (p2.coords.length === 3) segElevs.push(p2.coords[2]);
      
      const minElev = segElevs.length ? Math.min(...segElevs) : 7.75;
      const maxElev = segElevs.length ? Math.max(...segElevs) : 7.75;

      features.push({
        type: 'Feature',
        properties: {
          osmId:        way.id,
          segmentId:    segmentId,
          name:         way.tags?.name ?? '',
          highway:      way.tags?.highway ?? 'unclassified',
          minElevation: +minElev.toFixed(3),
          maxElevation: +maxElev.toFixed(3),
        },
        geometry: {
          type:        'LineString',
          coordinates: [p1.coords, p2.coords],
        },
      });
    }
  }

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      generated:  new Date().toISOString(),
      source:     'OpenStreetMap (roads) + USGS 3DEP EPQS (elevations)',
      datum:      'MLLW (converted from NAVD88 via -2.75 ft offset, NOAA CO-OPS station 8658163)',
      station:    'NOAA 8658163 — Carolina Beach, NC',
      bbox:       BBOX,
      featureCount: features.length,
    },
    features,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(geojson));
  console.log(`\n✅ Wrote ${features.length} road features → ${OUT_FILE}`);
  console.log(`   File size: ${(JSON.stringify(geojson).length / 1024).toFixed(0)} KB`);

  // Quick summary of elevation distribution
  const mins = features.map(f => f.properties.minElevation).sort((a, b) => a - b);
  console.log(`\n📊 Road min-elevation distribution (MLLW ft):`);
  console.log(`   ≤ 1.0 ft : ${mins.filter(v => v <= 1.0).length} roads`);
  console.log(`   ≤ 2.0 ft : ${mins.filter(v => v <= 2.0).length} roads`);
  console.log(`   ≤ 3.0 ft : ${mins.filter(v => v <= 3.0).length} roads`);
  console.log(`   ≤ 4.0 ft : ${mins.filter(v => v <= 4.0).length} roads`);
  console.log(`   > 4.0 ft : ${mins.filter(v => v >  4.0).length} roads`);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
