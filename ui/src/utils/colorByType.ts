import { CellResult } from '../store/useOptimizeStore';

const PALETTE: [number, number, number, number][] = [
  [22, 163, 74, 210],
  [21, 128, 61, 210],
  [30, 64, 175, 210],
  [180, 83, 9, 210],
  [168, 85, 247, 210],
  [14, 116, 144, 210],
];

function colorHash(key: string) {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function colorByDominantType(
  cell: CellResult,
): [number, number, number, number] {
  const dominantEntry = Object.entries(cell.tree_counts).sort((a, b) => b[1] - a[1])[0];
  if (!dominantEntry) return [100, 180, 100, 180];
  return PALETTE[colorHash(dominantEntry[0]) % PALETTE.length];
}
