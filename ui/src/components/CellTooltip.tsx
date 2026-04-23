import { CellResult, getTreeOptionMap } from '../store/useOptimizeStore';

interface Props {
  cell: CellResult;
}

const CellTooltip: React.FC<Props> = ({ cell }) => {
  const treeOptionMap = getTreeOptionMap();
  const counts = Object.entries(cell.tree_counts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="absolute bottom-8 left-4 bg-white rounded-lg shadow-lg p-3 text-sm z-20 min-w-[220px] max-w-[300px] pointer-events-none">
      <p className="font-semibold text-slate-700 mb-2">Planted cell</p>

      <div className="space-y-1 mb-2">
        {counts.map(([treeOptionId, count]) => (
          <div key={treeOptionId} className="flex justify-between gap-4">
            <span className="text-slate-500 truncate">
              {treeOptionMap[treeOptionId]?.common_name ?? treeOptionId}
            </span>
            <span className="font-medium">{count}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-2 space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Total trees</span>
          <span className="font-medium">{cell.total_trees}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Cooling delta</span>
          <span className="font-medium text-blue-600">
            -{cell.cooling_delta.toFixed(3)} &deg;C
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Cell cost</span>
          <span className="font-medium">${cell.total_cost.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-slate-500">Imperviousness</span>
          <span className="font-medium">{(cell.imperviousness * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
};

export default CellTooltip;
