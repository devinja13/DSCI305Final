import { TreeSize, PlantedTree } from '../store/useScenarioStore';

/**
 * Mocks the future python optimization model.
 * 
 * Takes in a budget and allowed tree types, and simulates a processing
 * delay to return a mathematically "optimal" array of tree placements around Houston.
 */
export const runMockOptimization = async (
    budget: number,
    allowedTypes: TreeSize[]
): Promise<PlantedTree[]> => {

    return new Promise((resolve) => {
        setTimeout(() => {
            const newTrees: PlantedTree[] = [];
            let remainingBudget = budget;

            // Houston center coordinates
            const baseLng = -95.3698;
            const baseLat = 29.7604;
            // The simulation boundary (roughly 0.1 deg ~ 11km)
            const spread = 0.15;

            // Tree costs
            const costs: Record<TreeSize, number> = {
                Small: 150,
                Medium: 300,
                Large: 500
            };

            // Continue "planting" until we can't afford the cheapest allowed tree
            const cheapestAllowed = Math.min(...allowedTypes.map(t => costs[t]));

            while (remainingBudget >= cheapestAllowed) {
                // Randomly pick one of the allowed tree types
                const randomType = allowedTypes[Math.floor(Math.random() * allowedTypes.length)];
                const cost = costs[randomType];

                if (remainingBudget >= cost) {
                    remainingBudget -= cost;

                    // Generate random coordinate near Houston using gaussian-like spread
                    const r1 = Math.random();
                    const r2 = Math.random();
                    const lngOffset = (Math.sqrt(-2.0 * Math.log(r1)) * Math.cos(2.0 * Math.PI * r2)) * spread * 0.3;
                    const latOffset = (Math.sqrt(-2.0 * Math.log(r1)) * Math.sin(2.0 * Math.PI * r2)) * spread * 0.3;

                    newTrees.push({
                        id: crypto.randomUUID(),
                        type: randomType,
                        lng: baseLng + lngOffset,
                        lat: baseLat + latOffset,
                        yearPlanted: 0 // Mock: everything planted immediately
                    });
                }
            }

            console.log("Mock Optimizer Generated", newTrees.length, "trees.");
            if (newTrees.length > 0) {
                const lngs = newTrees.map(t => t.lng);
                const lats = newTrees.map(t => t.lat);
                console.log(`Bounds: Lng [${Math.min(...lngs).toFixed(4)}, ${Math.max(...lngs).toFixed(4)}] Lat [${Math.min(...lats).toFixed(4)}, ${Math.max(...lats).toFixed(4)}]`);
                console.log("Sample tree:", newTrees[0]);
            }

            resolve(newTrees);
        }, 1500); // 1.5 second simulated delay
    });
};
