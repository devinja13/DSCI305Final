import { create } from 'zustand';

export type LayerType = 'trees' | 'cooling' | 'regions';
export type JobStatus = 'idle' | 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface LngLatPoint {
  lng: number;
  lat: number;
}

export interface TreeOption {
  tree_option_id: string;
  common_name: string;
  scientific_name: string;
  size_label: string;
  size_gallon: number | null;
  size_caliper_inches: number | null;
  size_classification: string;
  estimated_diameter_m: number;
  estimated_canopy_m: number;
  cost_usd: number;
  inventory: number;
  canopy_gain: number;
}

export interface RegionConstraint {
  id: string;
  name: string;
  polygon: LngLatPoint[];
  total_trees_exact: number | null;
  total_trees_min: number | null;
  total_trees_max: number | null;
}

export interface CellResult {
  lng: number;
  lat: number;
  bbox: [number, number, number, number];
  tree_counts: Record<string, number>;
  total_trees: number;
  total_cost: number;
  cooling_delta: number;
  canopy_gain: number;
  imperviousness: number;
  dominant_tree_option_id?: string | null;
}

export interface RegionSummary {
  id: string;
  name: string;
  total_trees: number;
}

export interface OptimizeSummary {
  status: string;
  runtime_s: number;
  cell_size_m: number;
  total_cells: number;
  total_trees: number;
  budget_used: number;
  budget_remaining: number;
  total_cooling_delta: number;
  trees_by_type: Record<string, number>;
  regions: RegionSummary[];
}

export interface OptimizeResult {
  summary: OptimizeSummary;
  cells: CellResult[];
}

interface OptimizeStore {
  budget: number;
  cellSizeM: 50 | 100 | 200;
  treeOptions: TreeOption[];
  selectedTreeOptionIds: string[];
  regions: RegionConstraint[];
  isDrawingRegion: boolean;
  jobId: string | null;
  jobStatus: JobStatus;
  progress: number;
  error: string | null;
  result: OptimizeResult | null;
  visibleLayers: Set<LayerType>;
  hoveredCell: CellResult | null;
  setBudget: (budget: number) => void;
  setCellSizeM: (cellSizeM: 50 | 100 | 200) => void;
  setTreeOptions: (options: TreeOption[]) => void;
  toggleTreeOption: (treeOptionId: string) => void;
  selectAllTreeOptions: (treeOptionIds?: string[]) => void;
  deselectAllTreeOptions: () => void;
  addRegion: (polygon: LngLatPoint[]) => void;
  updateRegion: (id: string, patch: Partial<RegionConstraint>) => void;
  removeRegion: (id: string) => void;
  setDrawingRegion: (isDrawing: boolean) => void;
  setJobId: (jobId: string) => void;
  setJobStatus: (jobStatus: JobStatus) => void;
  setProgress: (progress: number) => void;
  setResult: (result: OptimizeResult) => void;
  setError: (error: string) => void;
  toggleLayer: (layer: LayerType) => void;
  setHoveredCell: (cell: CellResult | null) => void;
  reset: () => void;
}

export const useOptimizeStore = create<OptimizeStore>((set) => ({
  budget: 1_000_000,
  cellSizeM: 100,
  treeOptions: [],
  selectedTreeOptionIds: [],
  regions: [],
  isDrawingRegion: false,
  jobId: null,
  jobStatus: 'idle',
  progress: 0,
  error: null,
  result: null,
  visibleLayers: new Set<LayerType>(['trees', 'cooling', 'regions']),
  hoveredCell: null,

  setBudget: (budget) => set({ budget }),
  setCellSizeM: (cellSizeM) => set({ cellSizeM }),

  setTreeOptions: (treeOptions) =>
    set((state) => ({
      treeOptions,
      selectedTreeOptionIds:
        state.selectedTreeOptionIds.length > 0
          ? state.selectedTreeOptionIds.filter((id) =>
              treeOptions.some((option) => option.tree_option_id === id),
            )
          : treeOptions.map((option) => option.tree_option_id),
    })),

  toggleTreeOption: (treeOptionId) =>
    set((state) => {
      const ids = new Set(state.selectedTreeOptionIds);
      if (ids.has(treeOptionId)) {
        ids.delete(treeOptionId);
      } else {
        ids.add(treeOptionId);
      }
      return { selectedTreeOptionIds: Array.from(ids) };
    }),

  selectAllTreeOptions: (treeOptionIds) =>
    set((state) => ({
      selectedTreeOptionIds:
        treeOptionIds && treeOptionIds.length > 0
          ? treeOptionIds
          : state.treeOptions.map((option) => option.tree_option_id),
    })),

  deselectAllTreeOptions: () => set({ selectedTreeOptionIds: [] }),

  addRegion: (polygon) =>
    set((state) => {
      const next = state.regions.length + 1;
      return {
        regions: [
          ...state.regions,
          {
            id: `region_${next}`,
            name: `Region ${next}`,
            polygon,
            total_trees_exact: 500,
            total_trees_min: null,
            total_trees_max: null,
          },
        ],
      };
    }),

  updateRegion: (id, patch) =>
    set((state) => ({
      regions: state.regions.map((region) =>
        region.id === id ? { ...region, ...patch } : region,
      ),
    })),

  removeRegion: (id) =>
    set((state) => ({
      regions: state.regions.filter((region) => region.id !== id),
    })),

  setDrawingRegion: (isDrawingRegion) => set({ isDrawingRegion }),

  setJobId: (jobId) =>
    set({ jobId, jobStatus: 'pending', progress: 0, error: null, result: null }),
  setJobStatus: (jobStatus) => set({ jobStatus }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) => set({ result, jobStatus: 'complete', progress: 100 }),
  setError: (error) => set({ error, jobStatus: 'failed' }),

  toggleLayer: (layer) =>
    set((state) => {
      const layers = new Set(state.visibleLayers);
      if (layers.has(layer)) {
        layers.delete(layer);
      } else {
        layers.add(layer);
      }
      return { visibleLayers: layers };
    }),

  setHoveredCell: (hoveredCell) => set({ hoveredCell }),

  reset: () =>
    set((state) => ({
      jobId: null,
      jobStatus: 'idle',
      progress: 0,
      error: null,
      result: null,
      hoveredCell: null,
      isDrawingRegion: false,
      regions: state.regions,
      treeOptions: state.treeOptions,
      selectedTreeOptionIds: state.selectedTreeOptionIds,
      budget: state.budget,
      cellSizeM: state.cellSizeM,
      visibleLayers: state.visibleLayers,
    })),
}));

export function getTreeOptionLabel(option: TreeOption) {
  return `${option.common_name} (${option.size_label})`;
}

export function getTreeOptionMap() {
  const treeOptions = useOptimizeStore.getState().treeOptions;
  return Object.fromEntries(treeOptions.map((option) => [option.tree_option_id, option]));
}

export function getSelectedTreeOptions() {
  const { treeOptions, selectedTreeOptionIds } = useOptimizeStore.getState();
  return treeOptions.filter((option) => selectedTreeOptionIds.includes(option.tree_option_id));
}
