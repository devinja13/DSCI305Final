import time
import numpy as np
import rasterio
from rasterio.transform import xy as rasterio_xy
from pyproj import Transformer
import gurobipy as gp
from gurobipy import GRB

from api.models import (
    OptimizeRequest, OptimizeResult, OptimizeSummary,
    CellResult, TreeType,
)
import api.job_store as job_store


# --- Raster data loaded once at startup ---
_canopy: np.ndarray = None
_imperv: np.ndarray = None
_transform = None
_crs = None
_coord_transformer: Transformer = None

CANOPY_PATH = "gurobi-model/ForUSTree_2018_HighVeg_TreeCoverage.tif"
IMPERV_PATH = "gurobi-model/texas_clipped.tif"


def load_raster_data():
    """Call once at FastAPI startup."""
    global _canopy, _imperv, _transform, _crs, _coord_transformer

    with rasterio.open(CANOPY_PATH) as src:
        _canopy = src.read(1).astype(np.float32)
        _transform = src.transform
        _crs = src.crs

    with rasterio.open(IMPERV_PATH) as src:
        _imperv = src.read(1).astype(np.float32)

    _coord_transformer = Transformer.from_crs(
        "EPSG:6344", "EPSG:4326", always_xy=True
    )
    print(f"Raster data loaded: {_canopy.shape[0]}×{_canopy.shape[1]} grid")


def _bbox_to_rowcol(region) -> tuple[int, int, int, int]:
    """Convert WGS84 bounding box to grid row/col range."""
    inv = Transformer.from_crs("EPSG:4326", "EPSG:6344", always_xy=True)
    x_w, y_n = inv.transform(region.west, region.north)
    x_e, y_s = inv.transform(region.east, region.south)

    t = _transform
    col_min = max(0, int((x_w - t.c) / t.a))
    col_max = min(_canopy.shape[1] - 1, int((x_e - t.c) / t.a))
    row_min = max(0, int((y_n - t.f) / t.e))
    row_max = min(_canopy.shape[0] - 1, int((y_s - t.f) / t.e))

    return row_min, row_max, col_min, col_max


def _cell_to_wgs84(row: int, col: int):
    """Return (lng, lat, bbox) for a grid cell."""
    x_proj, y_proj = rasterio_xy(_transform, row, col, offset="center")
    lng, lat = _coord_transformer.transform(x_proj, y_proj)
    dlat = 0.000225
    dlng = 0.000275
    bbox = [lng - dlng, lat - dlat, lng + dlng, lat + dlat]
    return lng, lat, bbox


def run_optimization(job_id: str, request: OptimizeRequest):
    """
    Background task. Runs Gurobi, extracts results, updates job store.
    Called by FastAPI BackgroundTasks — runs in a thread.
    """
    start = time.time()

    try:
        job_store.set_running(job_id)

        # --- Clip grid to requested region ---
        row_min, row_max, col_min, col_max = _bbox_to_rowcol(request.region)
        b = _canopy[row_min : row_max + 1, col_min : col_max + 1]
        imp = _imperv[row_min : row_max + 1, col_min : col_max + 1]
        n, p = b.shape

        job_store.set_progress(job_id, 5)
        if job_store.is_cancelled(job_id):
            return

        # --- Tree type configuration ---
        type_map = {
            TreeType.gal3:  {"cost": 8,  "gamma": 0.006},
            TreeType.gal5:  {"cost": 12, "gamma": 0.010},
            TreeType.gal10: {"cost": 20, "gamma": 0.018},
        }
        allowed = list(request.tree_types)
        K = len(allowed)
        costs  = np.array([type_map[t]["cost"]  for t in allowed], dtype=float)
        gammas = np.array([type_map[t]["gamma"] for t in allowed], dtype=float)
        
        # Determine capacity footprints
        capacities = []
        for t in allowed:
            if t == TreeType.gal3: capacities.append(3)
            elif t == TreeType.gal5: capacities.append(5)
            elif t == TreeType.gal10: capacities.append(10)
            else: capacities.append(1)
        capacities = np.array(capacities, dtype=float)

        site_cost = 20
        max_trees_per_cell = 100
        imp_threshold = 0.85

        # --- Availability mask ---
        a = (imp <= imp_threshold).astype(int)

        # --- Cooling coefficients (imperviousness-adjusted) ---
        HI1 = np.where(imp < 0.25, 0.0075,
               np.where(imp < 0.50, 0.0030, 0.0010))
        HI2 = np.where(imp < 0.25, 0.0200,
               np.where(imp < 0.50, 0.0250, 0.0180))
        beta = 1.0 + 0.75 * imp

        Mtot = np.maximum(0.80 - b, 0.0)

        # --- Build Gurobi model ---
        model = gp.Model("urban_forestry")
        model.setParam("OutputFlag", 0)
        model.setParam("TimeLimit", 900)

        # x[i,j,k] = number of trees of type k at cell (i,j)
        x = model.addMVar((n, p, K), vtype=GRB.INTEGER, lb=0, name="x")
        # y[i,j] = 1 if any trees planted at cell (i,j)
        y = model.addMVar((n, p), vtype=GRB.BINARY, name="y")

        ones_n = np.ones(n)
        ones_p = np.ones(p)

        # Budget constraint
        tree_cost_total = sum(
            costs[k] * (ones_n @ x[:, :, k] @ ones_p) for k in range(K)
        )
        model.addConstr(
            tree_cost_total + site_cost * (ones_n @ y @ ones_p) <= request.budget
        )

        # Site Capacity constraint (bounding total gallons to `max_trees_per_cell` capacity units)
        capacity_used = sum(capacities[k] * x[:, :, k] for k in range(K))
        model.addConstr(capacity_used <= max_trees_per_cell * y)

        # Only plant in available cells
        model.addConstr(y <= a)

        # Canopy capacity
        canopy_gain_per_cell = sum(gammas[k] * x[:, :, k] for k in range(K))
        model.addConstr(canopy_gain_per_cell <= Mtot)

        # Objective: maximize total cooling effect
        cooling = sum(
            (HI1 + HI2) * beta * gammas[k] * x[:, :, k]
            for k in range(K)
        )
        model.setObjective(cooling.sum(), GRB.MAXIMIZE)

        job_store.set_progress(job_id, 15)
        if job_store.is_cancelled(job_id):
            model.dispose()
            return

        model.optimize()

        job_store.set_progress(job_id, 90)

        # --- Extract results ---
        solve_status = "optimal" if model.Status == GRB.OPTIMAL else "time_limit"
        runtime = time.time() - start

        cells: list[CellResult] = []
        total_cost_used = 0.0
        total_cooling = 0.0
        trees_by_type: dict[str, int] = {t.value: 0 for t in allowed}

        x_vals = x.X   # shape (n, p, K)
        y_vals = y.X   # shape (n, p)

        planted_rows, planted_cols = np.where(y_vals > 0.5)

        for i, j in zip(planted_rows, planted_cols):
            tree_counts = [max(0, round(float(x_vals[i, j, k]))) for k in range(K)]
            total_trees_cell = sum(tree_counts)
            if total_trees_cell == 0:
                continue

            cell_tree_cost = sum(costs[k] * tree_counts[k] for k in range(K))
            cell_total_cost = cell_tree_cost + site_cost

            cell_cooling = sum(
                (HI1[i, j] + HI2[i, j]) * beta[i, j] * gammas[k] * tree_counts[k]
                for k in range(K)
            )
            cell_canopy_gain = sum(gammas[k] * tree_counts[k] for k in range(K))

            full_row = row_min + i
            full_col = col_min + j
            lng, lat, bbox = _cell_to_wgs84(full_row, full_col)

            count_by_type = {allowed[k].value: tree_counts[k] for k in range(K)}

            cells.append(CellResult(
                lng=lng, lat=lat, bbox=bbox,
                trees_3gal=count_by_type.get("3gal", 0),
                trees_5gal=count_by_type.get("5gal", 0),
                trees_10gal=count_by_type.get("10gal", 0),
                total_trees=total_trees_cell,
                total_cost=cell_total_cost,
                cooling_delta=round(cell_cooling, 4),
                canopy_gain=round(cell_canopy_gain, 4),
                imperviousness=round(float(imp[i, j]), 3),
            ))

            total_cost_used += cell_total_cost
            total_cooling += cell_cooling
            for k in range(K):
                trees_by_type[allowed[k].value] += tree_counts[k]

        summary = OptimizeSummary(
            status=solve_status,
            runtime_s=round(runtime, 2),
            total_cells=len(cells),
            total_trees=sum(trees_by_type.values()),
            budget_used=round(total_cost_used, 2),
            budget_remaining=round(request.budget - total_cost_used, 2),
            total_cooling_delta=round(total_cooling, 4),
            trees_by_type=trees_by_type,
        )

        result = OptimizeResult(summary=summary, cells=cells)
        job_store.set_complete(job_id, result)

    except Exception as e:
        job_store.set_failed(job_id, str(e))
        raise
