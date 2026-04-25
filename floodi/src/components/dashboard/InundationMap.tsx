import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Map, useApiIsLoaded } from '@vis.gl/react-google-maps';
import { DeckGL } from '@deck.gl/react';
import { PathLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import './InundationMap.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface RoadProperties {
  osmId:        number;
  segmentId?:   string;
  name:         string;
  highway:      string;
  minElevation: number; // ft MLLW — lowest point on the road segment
  maxElevation: number; // ft MLLW — highest point on the road segment (used for Virtual Bulkhead heuristic)
}

interface RoadFeature extends GeoJSON.Feature<GeoJSON.LineString, RoadProperties> {}

interface InundationMapProps {
  /** Current simulated or observed water level (ft MLLW) */
  waterLevelFt: number;
  /** Road GeoJSON with minElevation / maxElevation properties */
  roadData?: GeoJSON.FeatureCollection<GeoJSON.LineString, RoadProperties>;
  /** Current NOAA observed level for the status badge */
  observedLevelFt?: number;
}

// ── FIMAN colour ramp ────────────────────────────────────────────────────────
// depth = waterLevelFt − road.maxElevation

function floodDepthToColor(depth: number): [number, number, number, number] {
  if (depth <= 0)   return [0,   0,   0,   0];   // dry — invisible
  if (depth <= 0.5) return [255, 220,  30, 230];  // 🟡 mild
  if (depth <= 1.5) return [255, 120,   0, 240];  // 🟠 moderate
  return              [210,  35,  35, 250];        // 🔴 major
}

function floodDepthToWidth(depth: number): number {
  if (depth <= 0)   return 0;
  if (depth <= 0.5) return 5;
  if (depth <= 1.5) return 7;
  return 9;
}

function floodLabel(depth: number): string {
  if (depth <= 0)   return 'Dry';
  if (depth <= 0.5) return 'Mild flooding';
  if (depth <= 1.5) return 'Moderate flooding';
  return                   'Major flooding';
}

// ── Map config ───────────────────────────────────────────────────────────────
const INITIAL_VIEW_STATE = {
  longitude: -77.892,
  latitude:   34.042,
  zoom:       14.5,
  pitch:       0,
  bearing:     0,
};

// ── Component ────────────────────────────────────────────────────────────────
export const InundationMap: React.FC<InundationMapProps> = ({
  waterLevelFt,
  roadData,
  observedLevelFt,
}) => {
  const [pinnedRoad, setPinnedRoad] = useState<{feature: RoadFeature, x: number, y: number} | null>(null);

  // Build deck.gl PathLayer from road GeoJSON
  const layers = useMemo(() => {
    if (!roadData?.features?.length) return [];

    // The Virtual Bulkhead Heuristic (maxElevation)
    // We check if waterLevelFt > maxElevation instead of minElevation.
    // If a road segment runs down a bulkhead into a canal (e.g. node1=6.0ft, node2=2.8ft),
    // water must rise over the 6.0ft crown before it can flood the segment.
    // This perfectly approximates FIMAN's hydraulically-enforced models without requiring supercomputers!
    const flooded = roadData.features.filter(
      f => waterLevelFt - f.properties.maxElevation > 0
    );

    return [
      new PathLayer<RoadFeature>({
        id:             'flood-roads',
        data:           flooded,
        getPath:        f => f.geometry.coordinates as [number, number][],
        getWidth:       f => floodDepthToWidth(waterLevelFt - f.properties.maxElevation),
        getColor:       f => floodDepthToColor(waterLevelFt - f.properties.maxElevation),
        widthUnits:     'pixels',
        widthMinPixels: 3,
        widthScale:     1,
        jointRounded:   true,
        capRounded:     true,
        pickable:       true,
        onClick: (info) => {
          if (info.object) {
            setPinnedRoad({
              feature: info.object as RoadFeature,
              x: info.x,
              y: info.y
            });
          }
        },
        updateTriggers: {
          data:     [waterLevelFt],
          getColor: [waterLevelFt],
          getWidth: [waterLevelFt],
        },
      }),
    ];
  }, [roadData, waterLevelFt]);

  // Hover tooltip
  const getTooltip = ({ object }: PickingInfo) => {
    if (!object) return null;
    const f = object as RoadFeature;
    const depth = waterLevelFt - f.properties.maxElevation;
    const label = floodLabel(depth);
    const name  = f.properties.name || f.properties.highway;
    return {
      html: `
        <div class="flood-tooltip">
          <strong>${name}</strong><br/>
          <span style="font-size: 0.8em; color: #888;">ID: ${f.properties.segmentId || f.properties.osmId}</span><br/>
          <span class="flood-tooltip-status">${label}</span><br/>
          Road elev: ${f.properties.maxElevation.toFixed(2)} ft MLLW<br/>
          Depth: <strong>${depth.toFixed(2)} ft</strong>
        </div>`,
    };
  };

  const floodedCount = useMemo(() =>
    (roadData?.features ?? []).filter(f => waterLevelFt - f.properties.maxElevation > 0).length,
    [roadData, waterLevelFt]
  );

  return (
    <div className="inundation-map-wrapper">
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller
        layers={layers}
        getTooltip={pinnedRoad ? undefined : getTooltip}
        onClick={(info) => {
          if (!info.object) {
            setPinnedRoad(null);
          }
        }}
      >
        <Map
          mapId="map-inundation"
          mapTypeId="hybrid"
          reuseMaps
          defaultCenter={{ lat: INITIAL_VIEW_STATE.latitude, lng: INITIAL_VIEW_STATE.longitude }}
          defaultZoom={INITIAL_VIEW_STATE.zoom}
        />
      </DeckGL>

      {pinnedRoad && (
        <div className="pinned-road-modal" style={{ left: pinnedRoad.x, top: pinnedRoad.y }}>
          <button className="pinned-road-close" onClick={() => setPinnedRoad(null)}>×</button>
          <strong>{pinnedRoad.feature.properties.name || pinnedRoad.feature.properties.highway}</strong>
          <span style={{ fontSize: '0.8em', color: '#888' }}>
            ID: {pinnedRoad.feature.properties.segmentId || pinnedRoad.feature.properties.osmId}
          </span>
          <br/>
          <span className="pinned-road-status">
            {floodLabel(waterLevelFt - pinnedRoad.feature.properties.maxElevation)}
          </span>
          <br/>
          Road elev: {pinnedRoad.feature.properties.maxElevation.toFixed(2)} ft MLLW<br/>
          Depth: <strong>{(waterLevelFt - pinnedRoad.feature.properties.maxElevation).toFixed(2)} ft</strong>
        </div>
      )}

      {/* FIMAN-style legend */}
      <div className="flood-legend">
        <div className="flood-legend-row"><span className="swatch swatch-mild" />Mild (≤ 0.5 ft)</div>
        <div className="flood-legend-row"><span className="swatch swatch-moderate" />Moderate (≤ 1.5 ft)</div>
        <div className="flood-legend-row"><span className="swatch swatch-major" />Major (&gt; 1.5 ft)</div>
      </div>

      {/* Water level badge */}
      <div className="inundation-level-badge">
        {observedLevelFt !== undefined && (
          <span className="inundation-level-observed">
            OBS {observedLevelFt.toFixed(2)} ft
          </span>
        )}
        <span className="inundation-level-sim">
          SIM {waterLevelFt.toFixed(1)} ft
        </span>
        {floodedCount > 0 && (
          <span className="inundation-level-flooded">
            {floodedCount} roads flooded
          </span>
        )}
      </div>

      {/* No data notice */}
      {!roadData && (
        <div className="no-road-data-notice">
          <p>Road elevation data not loaded.</p>
          <code>node scripts/generateRoadElevations.mjs</code>
        </div>
      )}
    </div>
  );
};

export default InundationMap;
