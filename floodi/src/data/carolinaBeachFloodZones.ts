/**
 * Simplified inundation zone polygons for Carolina Beach, NC.
 *
 * Each feature has an `elevation` property (feet MLLW) representing the
 * approximate ground elevation.  The InundationMap renders features whose
 * elevation is ≤ the current water level, shaded by flood depth.
 *
 * Coordinates are approximate and intended for visualisation / prototyping.
 * Replace with an authoritative DEM-derived dataset for production use.
 */

export interface FloodZoneProperties {
  name: string;
  elevation: number; // feet MLLW — area floods when water >= this value
  zone: string;      // FEMA zone label (informational)
  description: string;
}

export const CAROLINA_BEACH_FLOOD_ZONES: GeoJSON.FeatureCollection<GeoJSON.Polygon, FloodZoneProperties> = {
  type: 'FeatureCollection',
  features: [
    // ── Zone 1 : Boat Basin / Marina (western shore, ~1.0 ft MLLW) ──────────
    {
      type: 'Feature',
      properties: {
        name: 'Boat Basin & Marina',
        elevation: 1.0,
        zone: 'VE',
        description: 'Low-lying marina and boat basin area on the sound side',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.8990, 34.0320],
          [-77.8920, 34.0320],
          [-77.8920, 34.0385],
          [-77.8990, 34.0385],
          [-77.8990, 34.0320],
        ]],
      },
    },

    // ── Zone 2 : Downtown Canal District (~1.5 ft MLLW) ─────────────────────
    {
      type: 'Feature',
      properties: {
        name: 'Downtown Canal District',
        elevation: 1.5,
        zone: 'AE',
        description: 'Canal network running through downtown Carolina Beach',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.8970, 34.0380],
          [-77.8870, 34.0380],
          [-77.8870, 34.0460],
          [-77.8970, 34.0460],
          [-77.8970, 34.0380],
        ]],
      },
    },

    // ── Zone 3 : Sound-Side Low Flats (~2.0 ft MLLW) ────────────────────────
    {
      type: 'Feature',
      properties: {
        name: 'Sound-Side Low Flats',
        elevation: 2.0,
        zone: 'AE',
        description: 'Low flats between the sound and US 421',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.9020, 34.0270],
          [-77.8950, 34.0270],
          [-77.8950, 34.0325],
          [-77.9020, 34.0325],
          [-77.9020, 34.0270],
        ]],
      },
    },

    // ── Zone 4 : Carolina Beach Lake Area (~2.5 ft MLLW) ────────────────────
    {
      type: 'Feature',
      properties: {
        name: 'Carolina Beach Lake Area',
        elevation: 2.5,
        zone: 'AE',
        description: 'Freshwater lake basin and surrounding low residential area',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.8975, 34.0455],
          [-77.8895, 34.0455],
          [-77.8895, 34.0520],
          [-77.8975, 34.0520],
          [-77.8975, 34.0455],
        ]],
      },
    },

    // ── Zone 5 : Northern Island / Snow's Cut approach (~2.0 ft MLLW) ───────
    {
      type: 'Feature',
      properties: {
        name: "Northern Island — Snow's Cut",
        elevation: 2.0,
        zone: 'AE',
        description: "Low terrain approaching Snow's Cut at the north end of the island",
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.9010, 34.0520],
          [-77.8860, 34.0520],
          [-77.8860, 34.0670],
          [-77.9010, 34.0670],
          [-77.9010, 34.0520],
        ]],
      },
    },

    // ── Zone 6 : Central Sound-Side Residential (~3.0 ft MLLW) ─────────────
    {
      type: 'Feature',
      properties: {
        name: 'Central Sound-Side Residential',
        elevation: 3.0,
        zone: 'AE',
        description: 'Mid-island residential streets on the western (sound) side',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.9015, 34.0385],
          [-77.8965, 34.0385],
          [-77.8965, 34.0460],
          [-77.9015, 34.0460],
          [-77.9015, 34.0385],
        ]],
      },
    },

    // ── Zone 7 : Southern Reach / Fort Fisher Approach (~3.0 ft MLLW) ───────
    {
      type: 'Feature',
      properties: {
        name: 'Southern Reach',
        elevation: 3.0,
        zone: 'AE',
        description: 'Southern tip of the island approaching Fort Fisher',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.9040, 34.0060],
          [-77.8830, 34.0060],
          [-77.8830, 34.0270],
          [-77.9040, 34.0270],
          [-77.9040, 34.0060],
        ]],
      },
    },

    // ── Zone 8 : Central Inland Low (~3.5 ft MLLW) ──────────────────────────
    {
      type: 'Feature',
      properties: {
        name: 'Central Inland Low',
        elevation: 3.5,
        zone: 'X',
        description: 'Slightly elevated central residential area, minimal flood risk',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-77.8960, 34.0460],
          [-77.8875, 34.0460],
          [-77.8875, 34.0520],
          [-77.8960, 34.0520],
          [-77.8960, 34.0460],
        ]],
      },
    },
  ],
};
