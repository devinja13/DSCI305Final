import { PlantedTree, TREE_SPECS } from '../store/useScenarioStore';

// Simple mock logic for calculating aggregate heat reduction metrics
// For the MVP, we just sum up the cooling potential of all trees
// taking into account how many years they've been growing.

export function calculateMetrics(
    trees: PlantedTree[],
    currentYear: number
) {
    let totalHeatReductionScore = 0;
    let estimatedAreaImpactedSqM = 0;

    trees.forEach(tree => {
        // Tree only provides cooling if it was planted in the past or currently
        if (tree.yearPlanted <= currentYear) {
            const yearsGrown = currentYear - tree.yearPlanted;
            const spec = TREE_SPECS[tree.type];

            // Radius increases with growth rate over time, up to a logical cap
            // E.g., assume 20 years is maturity
            const effectiveRadius = spec.coolingRadius * Math.min(1 + (yearsGrown * spec.growthRate * 0.05), 2.5);

            const area = Math.PI * Math.pow(effectiveRadius, 2);
            estimatedAreaImpactedSqM += area;

            // Mock heat reduction score (arbitrary units for visualization)
            const baseCooling = spec.cost * 0.1; // Tie cooling loosely to cost for the mock
            const effectiveCooling = baseCooling * Math.min(1 + (yearsGrown * spec.growthRate * 0.1), 3);
            totalHeatReductionScore += effectiveCooling;
        }
    });

    // Convert SqM to SqKm for display
    const areaSqKm = estimatedAreaImpactedSqM / 1000000;

    // Mock global average temp reduction % based on arbitrary scale for Houston context
    // Let's assume 10,000 max score = 5% reduction locally
    const tempReductionPercent = Math.min((totalHeatReductionScore / 10000) * 5, 10);

    return {
        totalTrees: trees.filter(t => t.yearPlanted <= currentYear).length,
        areaImpactedSqKm: areaSqKm,
        heatReductionScore: totalHeatReductionScore,
        tempReductionPercent: tempReductionPercent
    };
}

// Generates time-series data for the Recharts line chart
export function generateTimeSeriesData(trees: PlantedTree[]) {
    const data = [];
    for (let year = 0; year <= 20; year++) {
        const metrics = calculateMetrics(trees, year);
        data.push({
            year,
            heatReduction: metrics.tempReductionPercent,
            trees: metrics.totalTrees
        });
    }
    return data;
}

// Generate data for budget allocation pie/bar chart
export function generateAllocationData(trees: PlantedTree[]) {
    const allocation = {
        Small: 0,
        Medium: 0,
        Large: 0
    };

    trees.forEach(t => {
        allocation[t.type] += TREE_SPECS[t.type].cost;
    });

    return [
        { name: 'Small Trees', value: allocation.Small },
        { name: 'Medium Trees', value: allocation.Medium },
        { name: 'Large Trees', value: allocation.Large }
    ].filter(item => item.value > 0);
}
