import { create } from 'zustand';
import { runMockOptimization } from '../utils/mockOptimizer';

export type TreeSize = 'Small' | 'Medium' | 'Large';

export interface TreeData {
  cost: number;
  coolingRadius: number;
  growthRate: number;
}

export const TREE_SPECS: Record<TreeSize, TreeData> = {
  Small: { cost: 150, coolingRadius: 10, growthRate: 1.2 },
  Medium: { cost: 300, coolingRadius: 25, growthRate: 1.5 },
  Large: { cost: 500, coolingRadius: 50, growthRate: 1.8 },
};

export interface PlantedTree {
  id: string;
  type: TreeSize;
  lng: number;
  lat: number;
  yearPlanted: number;
}

interface ScenarioState {
  budget: number;
  initialBudget: number;
  trees: PlantedTree[];
  timeHorizon: number; // 0 to 20 years

  // Optimization State
  isOptimizing: boolean;
  allowedTreeTypes: TreeSize[];

  // Actions
  toggleAllowedTreeType: (type: TreeSize) => void;
  runOptimization: () => Promise<void>;
  setBudget: (amount: number) => void;
  setTimeHorizon: (year: number) => void;
  resetScenario: () => void;
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  budget: 100000,
  initialBudget: 100000,
  trees: [],
  timeHorizon: 0,

  isOptimizing: false,
  allowedTreeTypes: ['Small', 'Medium', 'Large'], // All allowed by default

  toggleAllowedTreeType: (type: TreeSize) => set((state) => {
    const types = new Set(state.allowedTreeTypes);
    if (types.has(type) && types.size > 1) { // Prevent deselecting last item
      types.delete(type);
    } else {
      types.add(type);
    }
    return { allowedTreeTypes: Array.from(types) };
  }),

  runOptimization: async () => {
    const { initialBudget, allowedTreeTypes } = get();

    set({ isOptimizing: true, trees: [], budget: initialBudget });

    try {
      const optimalTrees = await runMockOptimization(initialBudget, allowedTreeTypes);

      // Calculate used budget
      const usedBudget = optimalTrees.reduce((acc, t) => acc + TREE_SPECS[t.type].cost, 0);

      set({
        trees: optimalTrees,
        budget: initialBudget - usedBudget,
        isOptimizing: false
      });
    } catch (error) {
      console.error("Optimization failed:", error);
      set({ isOptimizing: false });
    }
  },

  setBudget: (amount) => set({
    budget: amount,
    initialBudget: amount,
    trees: [] // Reset trees when changing core base budget
  }),

  setTimeHorizon: (year) => set({ timeHorizon: year }),

  resetScenario: () => set((state) => ({
    budget: state.initialBudget,
    trees: [],
    isOptimizing: false
  })),
}));
