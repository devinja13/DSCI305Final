import { CellResult } from '../store/useOptimizeStore';

export function cellsToGeoJson(cells: CellResult[]) {
  return {
    type: 'FeatureCollection' as const,
    features: cells.map((cell) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [cell.bbox[0], cell.bbox[1]], // SW
            [cell.bbox[2], cell.bbox[1]], // SE
            [cell.bbox[2], cell.bbox[3]], // NE
            [cell.bbox[0], cell.bbox[3]], // NW
            [cell.bbox[0], cell.bbox[1]], // close
          ],
        ],
      },
      properties: { ...cell },
    })),
  };
}
