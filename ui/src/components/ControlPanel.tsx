import { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import { useJobPoller } from '../hooks/useJobPoller';
import LayerToggle from './LayerToggle';
import {
  getSelectedTreeOptions,
  getTreeOptionLabel,
  RegionConstraint,
  TreeOption,
  useOptimizeStore,
} from '../store/useOptimizeStore';

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

const HOUSTON_BBOX = {
  west: -95.789,
  south: 29.499,
  east: -94.99,
  north: 30.115,
};

const CELL_SIZE_HINTS: Record<50 | 100 | 200, string> = {
  50: 'Highest detail, slowest solve. Best when you need block-level precision.',
  100: 'Balanced option. Good default for faster runs with solid spatial detail.',
  200: 'Fastest solve, lowest detail. Best for rough planning and quick iteration.',
};

function RegionEditor({ region }: { region: RegionConstraint }) {
  const { updateRegion, removeRegion, jobStatus } = useOptimizeStore();
  const disabled = jobStatus === 'pending' || jobStatus === 'running';

  const setNumberOrNull = (field: 'total_trees_exact' | 'total_trees_min' | 'total_trees_max') =>
    (value: string) => {
      const parsed = value === '' ? null : Math.max(0, Number(value));
      if (field === 'total_trees_exact') {
        updateRegion(region.id, {
          total_trees_exact: parsed,
          total_trees_min: parsed === null ? region.total_trees_min : null,
          total_trees_max: parsed === null ? region.total_trees_max : null,
        });
        return;
      }

      updateRegion(region.id, {
        total_trees_exact: null,
        [field]: parsed,
      });
    };

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={region.name}
          onChange={(event) => updateRegion(region.id, { name: event.target.value })}
          disabled={disabled}
          className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => removeRegion(region.id)}
          disabled={disabled}
          className="text-xs font-semibold text-red-600"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
            Exact trees
          </span>
          <input
            type="number"
            min={0}
            value={region.total_trees_exact ?? ''}
            onChange={(event) => setNumberOrNull('total_trees_exact')(event.target.value)}
            disabled={disabled}
            className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
              Min trees
            </span>
            <input
              type="number"
              min={0}
              value={region.total_trees_min ?? ''}
              onChange={(event) => setNumberOrNull('total_trees_min')(event.target.value)}
              disabled={disabled}
              className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </label>

          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
              Max trees
            </span>
            <input
              type="number"
              min={0}
              value={region.total_trees_max ?? ''}
              onChange={(event) => setNumberOrNull('total_trees_max')(event.target.value)}
              disabled={disabled}
              className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function TreeOptionRow({ option }: { option: TreeOption }) {
  const { selectedTreeOptionIds, toggleTreeOption, jobStatus } = useOptimizeStore();
  const checked = selectedTreeOptionIds.includes(option.tree_option_id);
  const disabled = jobStatus === 'pending' || jobStatus === 'running';

  return (
    <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-slate-200 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggleTreeOption(option.tree_option_id)}
        disabled={disabled}
        className="mt-1 h-4 w-4 rounded accent-green-600"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-800">{option.common_name}</span>
          <span className="text-xs text-slate-500">{option.size_label}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>${option.cost_usd.toLocaleString()} each</span>
          <span>{option.inventory.toLocaleString()} in inventory</span>
          <span>{option.estimated_canopy_m} m canopy</span>
        </div>
      </div>
    </label>
  );
}

const ControlPanel: React.FC = () => {
  const {
    budget,
    setBudget,
    cellSizeM,
    setCellSizeM,
    treeOptions,
    setTreeOptions,
    selectedTreeOptionIds,
    selectAllTreeOptions,
    deselectAllTreeOptions,
    regions,
    isDrawingRegion,
    setDrawingRegion,
    jobStatus,
    jobId,
    setJobId,
    setError,
  } = useOptimizeStore();
  const [treeSearch, setTreeSearch] = useState('');

  useJobPoller();

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/tree-options`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: TreeOption[]) => {
        if (active) setTreeOptions(data);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'Failed to load tree options');
      });

    return () => {
      active = false;
    };
  }, [setError, setTreeOptions]);

  const isRunning = jobStatus === 'pending' || jobStatus === 'running';
  const filteredTreeOptions = useMemo(() => {
    const query = treeSearch.trim().toLowerCase();
    if (!query) return treeOptions;

    return treeOptions.filter((option) => {
      const haystack = [
        option.common_name,
        option.scientific_name,
        option.size_label,
        option.size_classification,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [treeOptions, treeSearch]);

  const handleSubmit = async () => {
    if (selectedTreeOptionIds.length === 0) {
      setError('Select at least one tree option before running the optimization.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget,
          cell_size_m: cellSizeM,
          tree_option_ids: selectedTreeOptionIds,
          region: HOUSTON_BBOX,
          selected_regions: regions,
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(detail || `HTTP ${res.status}`);
      }

      const { job_id } = await res.json();
      setJobId(job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit job');
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    await fetch(`${API_BASE}/job/${jobId}`, { method: 'DELETE' });
    useOptimizeStore.getState().reset();
  };

  const handleDownloadPdf = () => {
    const { result } = useOptimizeStore.getState();
    if (!result) return;

    const selectedOptions = getSelectedTreeOptions();
    const optionMap = Object.fromEntries(
      selectedOptions.map((option) => [option.tree_option_id, option]),
    );
    const doc = new jsPDF();
    const { summary, cells } = result;

    doc.setFontSize(18);
    doc.text('Urban Forestry Optimization Report', 14, 22);

    const summaryData = [
      ['Total Trees Selected', summary.total_trees.toString()],
      ['Cell Size', `${summary.cell_size_m}m`],
      ['Budget Used', `$${summary.budget_used.toLocaleString()}`],
      ['Budget Remaining', `$${summary.budget_remaining.toLocaleString()}`],
      ['Total Cells Planted', summary.total_cells.toString()],
      ['Total Cooling Delta', `${summary.total_cooling_delta.toFixed(2)} °C`],
    ];

    Object.entries(summary.trees_by_type).forEach(([treeOptionId, count]) => {
      const label = optionMap[treeOptionId]
        ? getTreeOptionLabel(optionMap[treeOptionId])
        : treeOptionId;
      summaryData.push([label, count.toString()]);
    });

    autoTable(doc, {
      startY: 32,
      head: [['Metric', 'Value']],
      body: summaryData,
      theme: 'grid',
      headStyles: { fillColor: [34, 197, 94] },
    });

    const finalY = (doc as jsPDF & { lastAutoTable?: { finalY?: number } }).lastAutoTable
      ?.finalY || 40;
    const tableData = cells.map((cell) => [
      cell.lat.toFixed(5),
      cell.lng.toFixed(5),
      cell.total_trees.toString(),
      Object.entries(cell.tree_counts)
        .map(([treeOptionId, count]) => `${optionMap[treeOptionId]?.common_name ?? treeOptionId}: ${count}`)
        .join(', '),
    ]);

    doc.setFontSize(14);
    doc.text('Tree Planting Locations', 14, finalY + 14);
    autoTable(doc, {
      startY: finalY + 18,
      head: [['Latitude', 'Longitude', 'Total Trees', 'Tree Mix']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [34, 197, 94] },
    });

    doc.save('forestry-optimization-report.pdf');
  };

  return (
    <aside className="w-[26rem] bg-white border-l border-slate-200 flex flex-col overflow-y-auto shrink-0 z-20">
      <div className="p-4 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Optimization</h2>
          <p className="text-xs text-slate-500">
            Set your budget, choose tree options, and draw Houston regions with planting rules.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Budget
          </label>
          <input
            type="number"
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            disabled={isRunning}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
          />
          <p className="text-xs text-slate-400">${budget.toLocaleString()}</p>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Cell size
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[50, 100, 200].map((size) => (
              <button
                key={size}
                type="button"
                disabled={isRunning}
                onClick={() => setCellSizeM(size as 50 | 100 | 200)}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                  cellSizeM === size
                    ? 'border-green-600 bg-green-50 text-green-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {size}m
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">
            Larger cells solve faster but give coarser placement results.
          </p>
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
            {CELL_SIZE_HINTS[cellSizeM]}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Constrained regions
              </p>
              <p className="text-xs text-slate-400">
                Draw a polygon on the map, then edit the rule here.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDrawingRegion(!isDrawingRegion)}
              disabled={isRunning}
              className={`rounded-lg px-3 py-2 text-xs font-semibold ${
                isDrawingRegion
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {isDrawingRegion ? 'Stop drawing' : 'Draw region'}
            </button>
          </div>

          {regions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
              No regions yet. Click "Draw region", add vertices on the map, and double-click to
              finish the shape.
            </div>
          ) : (
            <div className="space-y-3">
              {regions.map((region) => (
                <RegionEditor key={region.id} region={region} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Tree options
              </p>
              <span className="text-xs text-slate-400">
                {selectedTreeOptionIds.length} selected
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Each row is a species-size option from your CSV catalog.
            </p>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={treeSearch}
              onChange={(event) => setTreeSearch(event.target.value)}
              placeholder="Search tree name, species, or size"
              disabled={isRunning}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                Showing {filteredTreeOptions.length} of {treeOptions.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={isRunning || filteredTreeOptions.length === 0}
                  onClick={() =>
                    selectAllTreeOptions(
                      filteredTreeOptions.map((option) => option.tree_option_id),
                    )
                  }
                  className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  Select shown
                </button>
                <button
                  type="button"
                  disabled={isRunning || selectedTreeOptionIds.length === 0}
                  onClick={() => deselectAllTreeOptions()}
                  className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                >
                  Deselect all
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Tree options
            </p>
            <p className="text-xs text-slate-400">
              Tip: search and bulk-select a subset before refining individual rows.
            </p>
          </div>
          <div className="space-y-2 max-h-[24rem] overflow-y-auto pr-1">
            {filteredTreeOptions.length > 0 ? (
              filteredTreeOptions.map((option) => (
                <TreeOptionRow key={option.tree_option_id} option={option} />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-500">
                {treeOptions.length === 0
                  ? 'No tree options loaded yet. Make sure the FastAPI server is running, then refresh the page.'
                  : 'No tree options match your search.'}
              </div>
            )}
          </div>
        </div>

        {jobStatus === 'complete' && <LayerToggle />}

        <div className="space-y-2">
          {!isRunning ? (
            <button
              onClick={handleSubmit}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
            >
              Run optimization
            </button>
          ) : (
            <button
              onClick={handleCancel}
              className="w-full bg-red-100 hover:bg-red-200 text-red-700 font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          )}

          {jobStatus === 'complete' && (
            <button
              onClick={handleDownloadPdf}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
            >
              Download Report (PDF)
            </button>
          )}
        </div>

        {jobStatus === 'failed' && (
          <p className="text-xs text-red-600 bg-red-50 rounded p-2">
            {useOptimizeStore.getState().error ?? 'Optimization failed'}
          </p>
        )}
      </div>
    </aside>
  );
};

export default ControlPanel;
