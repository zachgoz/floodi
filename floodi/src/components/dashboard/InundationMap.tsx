import React, { useState, useMemo } from 'react';
import { Map } from '@vis.gl/react-google-maps';
import { DeckGL } from '@deck.gl/react';
import { PathLayer } from '@deck.gl/layers';
import type { PickingInfo } from '@deck.gl/core';
import { IconLayer, TextLayer } from '@deck.gl/layers';
import { WEBCAMS } from './constants/webcams';
import WebcamFeedCard from './WebcamFeedCard';
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

type RoadFeature = GeoJSON.Feature<GeoJSON.LineString, RoadProperties>;

interface InundationMapProps {
  /** Current simulated or observed water level (ft MLLW) */
  waterLevelFt: number;
  /** Road GeoJSON with minElevation / maxElevation properties */
  roadData?: GeoJSON.FeatureCollection<GeoJSON.LineString, RoadProperties>;
  /** Current NOAA observed level for the status badge */
  observedLevelFt?: number;
  /** Current time for the webcam feeds */
  targetTime?: Date;
  /** Optional callback to reset time to live */
  onResetToLive?: () => void;
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
  targetTime,
  onResetToLive,
}) => {
  const [pinnedRoad, setPinnedRoad] = useState<{feature: RoadFeature, x: number, y: number} | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<typeof WEBCAMS[0] | null>(null);

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

      // Webcam Icons Layer
      new IconLayer({
        id: 'webcam-icons',
        data: WEBCAMS,
        pickable: true,
        // Custom camera icon in a circular blue badge
        iconAtlas: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48Y2lyY2xlIGN4PSIzMiIgY3k9IjMyIiByPSIzMCIgZmlsbD0iIzFFM0E4QSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIzIi8+PHBhdGggZD0iTTQ2IDQyYTIgMiAwIDAgMS0yIDJIMjBhMiAyIDAgMCAxLTItMlYyOGEyIDIgMCAwIDEgMi0yaDRsMi0zaDEybDIgM2g0YTIgMiAwIDAgMSAyIDJ6IiBmaWxsPSJ3aGl0ZSIvPjxjaXJjbGUgY3g9IjMyIiBjeT0iMzUiIHI9IjQiIGZpbGw9IiMxRTNBOEEiLz48L3N2Zz4=',
        iconMapping: {
          // Setting anchorY to 64 so the bottom of the icon is at the coordinate
          camera: {x: 0, y: 0, width: 64, height: 64, anchorY: 64, mask: false}
        },
        getIcon: d => 'camera',
        getPosition: d => [d.lng, d.lat],
        getSize: 30, // Slightly smaller for better fit
        onClick: (info) => {
          if (info.object) {
            setSelectedCamera(info.object);
          }
        }
      }),

      // Webcam Labels Layer
      new TextLayer({
        id: 'webcam-labels',
        data: WEBCAMS,
        getPosition: d => [d.lng, d.lat],
        getText: d => d.name,
        getSize: 13,
        getAngle: 0,
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'top',
        getColor: [255, 255, 255],
        outlineWidth: 3,
        outlineColor: [30, 58, 138],
        pixelOffset: [0, 8], // 8px below the icon's bottom edge
        fontFamily: 'Outfit, sans-serif',
        fontWeight: 700
      })
    ];
  }, [roadData, waterLevelFt]);

  // Hover tooltip
  const getTooltip = (info: PickingInfo) => {
    const { object, layer } = info;
    if (!object) return null;

    // Handle Webcam tooltips
    if (layer?.id === 'webcam-icons') {
      return {
        html: `
          <div class="flood-tooltip">
            <strong>${(object as any).name}</strong><br/>
            <span style="color: #ffdc1e; font-weight: 600;">Click to view camera feed</span>
          </div>`
      };
    }

    // Handle Road tooltips
    if (layer?.id === 'flood-roads') {
      const f = object as RoadFeature;
      // Safety check for properties
      if (!f.properties) return null;
      
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
    }

    return null;
  };

  const floodedCount = useMemo(() =>
    (roadData?.features ?? []).filter(f => waterLevelFt - f.properties.maxElevation > 0).length,
    [roadData, waterLevelFt]
  );

  const timeLabel = useMemo(() => {
    if (!targetTime) return 'Live Observed Water Level';
    const now = new Date();
    const isFuture = targetTime.getTime() > now.getTime() + 10 * 60 * 1000; // 10 min buffer
    const isPast = targetTime.getTime() < now.getTime() - 10 * 60 * 1000;
    
    if (isFuture) return 'FloodCast Water Level';
    if (isPast) return 'Observed Water Level';
    return 'Live Observed Water Level';
  }, [targetTime]);

  return (
    <div className="inundation-map-wrapper">
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE}
        controller={{
          dragPan: true,
          scrollZoom: false,
          touchRotate: false,
          dragRotate: false,
          // Require two fingers for touch panning to allow page scrolling
          dragMode: 'pan',
        }}
        layers={layers}
        getTooltip={pinnedRoad ? undefined : getTooltip}
        onClick={(info) => {
          if (!info.object) {
            setPinnedRoad(null);
          }
        }}
      >
        <Map
          mapTypeId="hybrid"
          reuseMaps
          defaultCenter={{ lat: INITIAL_VIEW_STATE.latitude, lng: INITIAL_VIEW_STATE.longitude }}
          defaultZoom={INITIAL_VIEW_STATE.zoom}
          gestureHandling="greedy"
          styles={[
            {
              featureType: "poi",
              stylers: [{ visibility: "off" }]
            },
            {
              featureType: "transit",
              stylers: [{ visibility: "off" }]
            },
            {
              featureType: "all",
              elementType: "labels.icon",
              stylers: [{ visibility: "off" }]
            }
          ]}
        >
          {/* InfoWindow removed in favor of floating panel to ensure interaction works above DeckGL */}
        </Map>
      </DeckGL>

      {/* Floating Webcam Panel - Sits above DeckGL canvas for reliable interaction */}
      {selectedCamera && (
        <div className="map-webcam-overlay">
          <WebcamFeedCard
            cameraId={selectedCamera.id}
            locationName={selectedCamera.name}
            targetTime={targetTime || new Date()}
            onResetToLive={onResetToLive}
            onClose={() => setSelectedCamera(null)}
          />
        </div>
      )}

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
        <span className="inundation-level-sim">
          {timeLabel}: <strong style={{ color: '#fff' }}>{waterLevelFt.toFixed(2)} ft</strong>
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
