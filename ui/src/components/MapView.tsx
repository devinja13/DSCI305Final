import { useEffect, useRef, useState } from 'react';
import maplibregl, { LngLatLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';

import CellTooltip from './CellTooltip';
import { LngLatPoint, useOptimizeStore } from '../store/useOptimizeStore';
import { cellsToGeoJson } from '../utils/cellsToGeoJson';
import { colorByDominantType } from '../utils/colorByType';
import { regionsToGeoJson } from '../utils/regionsToGeoJson';

const HOUSTON_CENTER: [number, number] = [-95.3698, 29.7604];

function draftPolygonToFeature(points: LngLatPoint[]) {
  if (points.length === 0) {
    return { type: 'FeatureCollection' as const, features: [] };
  }

  if (points.length < 3) {
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          geometry: {
            type: 'LineString' as const,
            coordinates: points.map((point) => [point.lng, point.lat]),
          },
          properties: {},
        },
      ],
    };
  }

  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [
            points
              .map((point) => [point.lng, point.lat])
              .concat([[points[0].lng, points[0].lat]]),
          ],
        },
        properties: {},
      },
    ],
  };
}

const MapView: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [draftPoints, setDraftPoints] = useState<LngLatPoint[]>([]);

  const {
    result,
    visibleLayers,
    setHoveredCell,
    hoveredCell,
    jobStatus,
    regions,
    isDrawingRegion,
    addRegion,
  } = useOptimizeStore();

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: HOUSTON_CENTER as LngLatLike,
      zoom: 10,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    overlay.current = new MapboxOverlay({ layers: [] });
    map.current.addControl(overlay.current as unknown as maplibregl.IControl);
    map.current.on('load', () => setMapLoaded(true));

    return () => {
      overlay.current?.finalize();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;

    if (isDrawingRegion) {
      map.current.doubleClickZoom.disable();
    } else {
      map.current.doubleClickZoom.enable();
    }

    return () => {
      map.current?.doubleClickZoom.enable();
    };
  }, [isDrawingRegion]);

  useEffect(() => {
    if (!mapLoaded || !map.current) return;

    const handleClick = (event: maplibregl.MapMouseEvent) => {
      if (!isDrawingRegion) return;

      setDraftPoints((points) => [...points, { lng: event.lngLat.lng, lat: event.lngLat.lat }]);
    };

    const handleDoubleClick = (event: maplibregl.MapMouseEvent) => {
      if (!isDrawingRegion) return;
      event.preventDefault();

      setDraftPoints((points) => {
        const nextPoints = [...points, { lng: event.lngLat.lng, lat: event.lngLat.lat }];
        if (nextPoints.length >= 3) {
          addRegion(nextPoints);
        }
        return [];
      });
    };

    map.current.on('click', handleClick);
    map.current.on('dblclick', handleDoubleClick);

    return () => {
      map.current?.off('click', handleClick);
      map.current?.off('dblclick', handleDoubleClick);
    };
  }, [addRegion, isDrawingRegion, mapLoaded]);

  useEffect(() => {
    if (!isDrawingRegion) {
      setDraftPoints([]);
    }
  }, [isDrawingRegion]);

  useEffect(() => {
    if (!mapLoaded || !overlay.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [];

    if (result && visibleLayers.has('cooling')) {
      const heatmapData = result.cells.map((cell) => ({
        coordinates: [cell.lng, cell.lat] as [number, number],
        weight: cell.cooling_delta,
      }));
      const maxCooling = Math.max(...result.cells.map((cell) => cell.cooling_delta), 0.001);

      layers.push(
        new HeatmapLayer({
          id: 'cooling-heatmap',
          data: heatmapData,
          getPosition: (d: { coordinates: [number, number] }) => d.coordinates,
          getWeight: (d: { weight: number }) => d.weight,
          colorDomain: [0, maxCooling] as [number, number],
          colorRange: [
            [239, 246, 255, 0],
            [191, 219, 254, 90],
            [96, 165, 250, 120],
            [251, 146, 60, 160],
            [239, 68, 68, 190],
          ] as [number, number, number, number][],
          radiusPixels: 24,
          intensity: 0.65,
          threshold: 0.08,
          opacity: 0.55,
        }),
      );
    }

    if (result && visibleLayers.has('trees')) {
      layers.push(
        new GeoJsonLayer({
          id: 'tree-cells',
          data: cellsToGeoJson(result.cells),
          filled: true,
          stroked: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getFillColor: (feature: any) => {
            const [r, g, b] = colorByDominantType(feature.properties);
            return [r, g, b, 45];
          },
          getLineColor: [255, 255, 255, 80] as [number, number, number, number],
          lineWidthMinPixels: 0.35,
          pickable: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onHover: (info: any) => {
            setHoveredCell(info.object ? info.object.properties : null);
          },
        }),
      );

      layers.push(
        new ScatterplotLayer({
          id: 'tree-bubbles',
          data: result.cells,
          getPosition: (cell: { lng: number; lat: number }) => [cell.lng, cell.lat],
          getRadius: (cell: { total_trees: number }) => Math.max(80, cell.total_trees * 6),
          radiusUnits: 'meters',
          radiusMinPixels: 5,
          radiusMaxPixels: 22,
          filled: true,
          stroked: true,
          getFillColor: [34, 197, 94, 120],
          getLineColor: [21, 128, 61, 180],
          lineWidthMinPixels: 1,
          pickable: false,
        }),
      );
    }

    if (visibleLayers.has('regions') && regions.length > 0) {
      layers.push(
        new GeoJsonLayer({
          id: 'selected-regions',
          data: regionsToGeoJson(regions),
          filled: true,
          stroked: true,
          getFillColor: [245, 158, 11, 24],
          getLineColor: [217, 119, 6, 220],
          lineWidthMinPixels: 2.5,
        }),
      );
    }

    if (isDrawingRegion && draftPoints.length > 0) {
      layers.push(
        new GeoJsonLayer({
          id: 'draft-region',
          data: draftPolygonToFeature(draftPoints),
          filled: draftPoints.length >= 3,
          stroked: true,
          getFillColor: [59, 130, 246, 28],
          getLineColor: [37, 99, 235, 230],
          lineWidthMinPixels: 2,
        }),
      );

      layers.push(
        new ScatterplotLayer({
          id: 'draft-region-points',
          data: draftPoints,
          getPosition: (point: LngLatPoint) => [point.lng, point.lat],
          getRadius: 22,
          radiusUnits: 'meters',
          radiusMinPixels: 4,
          radiusMaxPixels: 6,
          getFillColor: [37, 99, 235, 220],
          stroked: true,
          getLineColor: [255, 255, 255, 220],
          lineWidthMinPixels: 1,
        }),
      );
    }

    overlay.current.setProps({ layers });
  }, [draftPoints, isDrawingRegion, mapLoaded, regions, result, setHoveredCell, visibleLayers]);

  return (
    <div className="absolute inset-0 w-full h-full">
      <div ref={mapContainer} className="absolute inset-0" />

      {isDrawingRegion && (
        <div className="absolute top-4 left-4 z-30 rounded-lg bg-white/95 px-4 py-3 shadow-lg max-w-sm">
          <p className="text-sm font-semibold text-slate-800">Draw a constrained region</p>
          <p className="text-xs text-slate-500">
            Click to add vertices. Double-click to finish the polygon. Use the panel button to stop
            drawing.
          </p>
          {draftPoints.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraftPoints([])}
                className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
              >
                Clear points
              </button>
              <span className="text-xs text-slate-400">{draftPoints.length} vertices</span>
            </div>
          )}
        </div>
      )}

      {(jobStatus === 'pending' || jobStatus === 'running') && (
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm z-30 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full text-center flex flex-col items-center">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-green-600 rounded-full animate-spin mb-4" />
            <h3 className="text-lg font-bold text-slate-800 mb-1">Running optimization</h3>
            <p className="text-sm text-slate-500">
              Gurobi is solving the planting model with your selected tree catalog and regional
              constraints.
            </p>
          </div>
        </div>
      )}

      {hoveredCell && <CellTooltip cell={hoveredCell} />}
    </div>
  );
};

export default MapView;
