import time

import gurobipy as gp
import numpy as np
import rasterio
from gurobipy import GRB
from pyproj import Transformer
from rasterio.transform import xy as rasterio_xy

import api.job_store as job_store
from api.models import (
    CellResult,
    OptimizeRequest,
    OptimizeResult,
    OptimizeSummary,
    RegionBbox,
    RegionPoint,
    RegionSummary,
)
from api.tree_catalog import load_tree_catalog_map


CANOPY_PATH = "gurobi-model/ForUSTree_2018_HighVeg_TreeCoverage.tif"
IMPERV_PATH = "gurobi-model/texas_clipped.tif"

_canopy: np.ndarray | None = None
_imperv: np.ndarray | None = None
_transform = None
_coord_transformer: Transformer | None = None
_inverse_transformer: Transformer | None = None
_native_cell_size_m: float | None = None

VALID_CELL_SIZES = {50, 100, 200}


def load_raster_data():
    global _canopy, _imperv, _transform, _coord_transformer, _inverse_transformer, _native_cell_size_m

    if _canopy is not None and _imperv is not None:
        return

    with rasterio.open(CANOPY_PATH) as src:
        _canopy = src.read(1).astype(np.float32)
        _transform = src.transform
        raster_crs = src.crs
        _native_cell_size_m = float(src.res[0])

    with rasterio.open(IMPERV_PATH) as src:
        _imperv = src.read(1).astype(np.float32)

    _coord_transformer = Transformer.from_crs(raster_crs, "EPSG:4326", always_xy=True)
    _inverse_transformer = Transformer.from_crs("EPSG:4326", raster_crs, always_xy=True)


def _bbox_to_rowcol(region: RegionBbox) -> tuple[int, int, int, int]:
    x_w, y_n = _inverse_transformer.transform(region.west, region.north)
    x_e, y_s = _inverse_transformer.transform(region.east, region.south)

    t = _transform
    col_min = max(0, int((x_w - t.c) / t.a))
    col_max = min(_canopy.shape[1] - 1, int((x_e - t.c) / t.a))
    row_min = max(0, int((y_n - t.f) / t.e))
    row_max = min(_canopy.shape[0] - 1, int((y_s - t.f) / t.e))

    return row_min, row_max, col_min, col_max


def _cell_to_wgs84(row: int, col: int):
    x_proj, y_proj = rasterio_xy(_transform, row, col, offset="center")
    lng, lat = _coord_transformer.transform(x_proj, y_proj)
    dlat = 0.000225
    dlng = 0.000275
    bbox = [lng - dlng, lat - dlat, lng + dlng, lat + dlat]
    return lng, lat, bbox


def _polygon_bbox(points: list[RegionPoint]) -> RegionBbox:
    return RegionBbox(
        west=min(point.lng for point in points),
        south=min(point.lat for point in points),
        east=max(point.lng for point in points),
        north=max(point.lat for point in points),
    )


def _point_in_polygon(lng: float, lat: float, polygon: list[RegionPoint]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i].lng, polygon[i].lat
        xj, yj = polygon[j].lng, polygon[j].lat
        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _validate_cell_size(cell_size_m: int) -> int:
    if cell_size_m not in VALID_CELL_SIZES:
        raise ValueError(f"Unsupported cell size '{cell_size_m}'. Choose one of {sorted(VALID_CELL_SIZES)}.")
    return cell_size_m


def _aggregation_factor(cell_size_m: int) -> int:
    target = _validate_cell_size(cell_size_m)
    factor = round(target / _native_cell_size_m)
    return max(1, factor)


def _aggregate_grid(grid: np.ndarray, factor: int, mode: str) -> np.ndarray:
    if factor == 1:
        return grid

    rows, cols = grid.shape
    new_rows = (rows + factor - 1) // factor
    new_cols = (cols + factor - 1) // factor
    pad_rows = new_rows * factor - rows
    pad_cols = new_cols * factor - cols
    padded = np.pad(grid, ((0, pad_rows), (0, pad_cols)), constant_values=np.nan)
    reshaped = padded.reshape(new_rows, factor, new_cols, factor)

    if mode == "mean":
        return np.nanmean(reshaped, axis=(1, 3))
    if mode == "max":
        return np.nanmax(reshaped, axis=(1, 3))

    raise ValueError(f"Unsupported aggregation mode '{mode}'.")


def _aggregated_cell_geometry(
    full_row_start: int,
    full_row_end: int,
    full_col_start: int,
    full_col_end: int,
):
    x_left = _transform.c + full_col_start * _transform.a
    x_right = _transform.c + (full_col_end + 1) * _transform.a
    y_top = _transform.f + full_row_start * _transform.e
    y_bottom = _transform.f + (full_row_end + 1) * _transform.e

    corners_proj = [
        (x_left, y_top),
        (x_right, y_top),
        (x_right, y_bottom),
        (x_left, y_bottom),
    ]
    corners_wgs84 = [_coord_transformer.transform(x, y) for x, y in corners_proj]
    lngs = [corner[0] for corner in corners_wgs84]
    lats = [corner[1] for corner in corners_wgs84]

    bbox = [min(lngs), min(lats), max(lngs), max(lats)]
    lng = (bbox[0] + bbox[2]) / 2
    lat = (bbox[1] + bbox[3]) / 2
    return lng, lat, bbox


def _region_cells_from_polygon(
    polygon: list[RegionPoint],
    global_row_min: int,
    global_row_max: int,
    global_col_min: int,
    global_col_max: int,
    factor: int,
) -> list[tuple[int, int]]:
    row_min, row_max, col_min, col_max = _bbox_to_rowcol(_polygon_bbox(polygon))

    row_min = max(row_min, global_row_min)
    row_max = min(row_max, global_row_max)
    col_min = max(col_min, global_col_min)
    col_max = min(col_max, global_col_max)

    if row_min > row_max or col_min > col_max:
        return []

    agg_row_min = (row_min - global_row_min) // factor
    agg_row_max = (row_max - global_row_min) // factor
    agg_col_min = (col_min - global_col_min) // factor
    agg_col_max = (col_max - global_col_min) // factor

    cells: list[tuple[int, int]] = []
    for row in range(agg_row_min, agg_row_max + 1):
        for col in range(agg_col_min, agg_col_max + 1):
            full_row_start = global_row_min + row * factor
            full_col_start = global_col_min + col * factor
            full_row_end = min(global_row_min + (row + 1) * factor - 1, global_row_max)
            full_col_end = min(global_col_min + (col + 1) * factor - 1, global_col_max)
            lng, lat, _ = _aggregated_cell_geometry(
                full_row_start,
                full_row_end,
                full_col_start,
                full_col_end,
            )
            if _point_in_polygon(lng, lat, polygon):
                cells.append((row, col))

    return cells


def forestry_mip(
    budget: float,
    canopy_grid: np.ndarray,
    imperv_grid: np.ndarray,
    tree_type_names: list[str],
    tree_cost_dict: dict[str, float],
    tree_canopy_gain_dict: dict[str, float],
    tree_inventory_limit_dict: dict[str, int],
    selected_regions: dict[str, list[tuple[int, int]]] | None = None,
    region_requirements: dict[str, dict] | None = None,
    site_cost: float = 20.0,
    max_trees_per_site: int = 100,
    imp_threshold: float = 0.85,
    verbose: bool = False,
):
    if canopy_grid.shape != imperv_grid.shape:
        raise ValueError("canopy_grid and imperv_grid must have the same shape.")

    n, p = canopy_grid.shape
    selected_regions = selected_regions or {}
    region_requirements = region_requirements or {}

    K = len(tree_type_names)
    t = np.array([tree_cost_dict[name] for name in tree_type_names], dtype=float)
    gamma = np.array([tree_canopy_gain_dict[name] for name in tree_type_names], dtype=float)
    inventory_limits = np.array(
        [tree_inventory_limit_dict[name] for name in tree_type_names],
        dtype=float,
    )

    capacities = []
    for name in tree_type_names:
        digits = "".join(ch for ch in name if ch.isdigit())
        capacities.append(float(digits) if digits else 1.0)
    capacities = np.array(capacities, dtype=float)

    a = (imperv_grid <= imp_threshold).astype(int)

    hi1 = np.where(
        imperv_grid < 0.25,
        0.75 / 100.0,
        np.where(imperv_grid < 0.50, 0.30 / 100.0, 0.10 / 100.0),
    )
    hi2 = np.where(
        imperv_grid < 0.25,
        2.00 / 100.0,
        np.where(imperv_grid < 0.50, 2.50 / 100.0, 1.80 / 100.0),
    )
    beta = 1.0 + 0.75 * imperv_grid

    u = np.maximum(0.40 - canopy_grid, 0.0)
    mtot = np.maximum(0.80 - canopy_grid, 0.0)

    model = gp.Model("ForestryFrontendMIP")
    model.Params.OutputFlag = 1 if verbose else 0
    model.Params.TimeLimit = 900

    x = model.addMVar(shape=(n, p, K), vtype=GRB.INTEGER, lb=0, name="x")
    y = model.addMVar(shape=(n, p), vtype=GRB.BINARY, name="y")
    add_canopy = model.addMVar(shape=(n, p), vtype=GRB.CONTINUOUS, lb=0.0, name="addCanopy")
    z1 = model.addMVar(shape=(n, p), vtype=GRB.CONTINUOUS, lb=0.0, name="z1")
    z2 = model.addMVar(shape=(n, p), vtype=GRB.CONTINUOUS, lb=0.0, name="z2")
    w = model.addMVar(shape=(n, p), vtype=GRB.BINARY, name="cross40")

    model.addConstr(
        gp.quicksum(t[k] * x[:, :, k].sum() for k in range(K)) + site_cost * y.sum() <= budget,
        name="budget",
    )
    model.addConstr(
        gp.quicksum(capacities[k] * x[:, :, k] for k in range(K)) <= max_trees_per_site * y,
        name="maxCapacityPerSite",
    )
    model.addConstr(y <= a, name="allowedSites")
    model.addConstr(
        add_canopy == gp.quicksum(gamma[k] * x[:, :, k] for k in range(K)),
        name="canopy_from_trees",
    )
    model.addConstr(add_canopy <= mtot, name="cap_at_80")
    model.addConstr(z1 + z2 == add_canopy, name="split_canopy")
    model.addConstr(z1 <= u, name="band1_cap")
    model.addConstr(add_canopy <= u + mtot * w, name="cross_logic_a")
    model.addConstr(z2 <= mtot * w, name="cross_logic_z2")
    model.addConstr(z1 >= u * w, name="cross_logic_fill1")
    model.addConstr(z1 <= add_canopy, name="z1_le_add")

    for k in range(K):
        model.addConstr(
            x[:, :, k].sum() <= inventory_limits[k],
            name=f"inventory_limit_{tree_type_names[k]}",
        )

    tree_type_to_idx = {name: k for k, name in enumerate(tree_type_names)}
    for region_id, req in region_requirements.items():
        cells = selected_regions.get(region_id, [])
        if not cells:
            raise ValueError(f"Region '{region_id}' does not contain any grid cells.")

        total_region_trees = gp.quicksum(x[i, j, k] for (i, j) in cells for k in range(K))
        exact = req.get("total_trees_exact")
        min_count = req.get("total_trees_min")
        max_count = req.get("total_trees_max")

        if exact is not None:
            model.addConstr(total_region_trees == exact, name=f"{region_id}_total_exact")
        else:
            if min_count is not None:
                model.addConstr(total_region_trees >= min_count, name=f"{region_id}_total_min")
            if max_count is not None:
                model.addConstr(total_region_trees <= max_count, name=f"{region_id}_total_max")

        for tree_name, count in req.get("tree_type_counts", {}).items():
            k = tree_type_to_idx[tree_name]
            model.addConstr(
                gp.quicksum(x[i, j, k] for (i, j) in cells) == count,
                name=f"{region_id}_{tree_name}_count",
            )

    degrees_cooled = 100.0 * ((beta * hi1 * z1).sum() + (beta * hi2 * z2).sum())
    model.setObjective(degrees_cooled, GRB.MAXIMIZE)
    model.optimize()

    status_map = {
        GRB.OPTIMAL: "OPTIMAL",
        GRB.INFEASIBLE: "INFEASIBLE",
        GRB.UNBOUNDED: "UNBOUNDED",
        GRB.INF_OR_UNBD: "INF_OR_UNBD",
        GRB.TIME_LIMIT: "TIME_LIMIT",
    }

    result = {
        "status_code": int(model.Status),
        "status": status_map.get(model.Status, f"STATUS_{model.Status}"),
        "objective_value": None,
        "total_trees": 0,
        "total_cost": 0.0,
        "trees_by_type": {name: 0 for name in tree_type_names},
        "activated_sites": 0,
        "x_sol": None,
        "y_sol": None,
        "region_tree_totals": {region_id: 0 for region_id in selected_regions},
    }

    if model.SolCount > 0:
        x_sol = np.rint(x.X).astype(int)
        y_sol = y.X
        total_tree_cost = sum(t[k] * x_sol[:, :, k].sum() for k in range(K))
        total_site_cost = site_cost * int((y_sol > 0.5).sum())
        trees_by_type = {
            tree_type_names[k]: int(x_sol[:, :, k].sum())
            for k in range(K)
        }
        region_tree_totals = {
            region_id: int(sum(x_sol[i, j, :].sum() for (i, j) in cells))
            for region_id, cells in selected_regions.items()
        }
        result.update(
            {
                "objective_value": float(model.ObjVal),
                "total_trees": int(x_sol.sum()),
                "total_cost": float(total_tree_cost + total_site_cost),
                "trees_by_type": trees_by_type,
                "activated_sites": int((y_sol > 0.5).sum()),
                "x_sol": x_sol,
                "y_sol": y_sol,
                "region_tree_totals": region_tree_totals,
            }
        )

    return result


def run_optimization(job_id: str, request: OptimizeRequest):
    load_raster_data()
    start = time.time()

    try:
        job_store.set_running(job_id)
        factor = _aggregation_factor(request.cell_size_m)

        row_min, row_max, col_min, col_max = _bbox_to_rowcol(request.region)
        native_canopy = _canopy[row_min : row_max + 1, col_min : col_max + 1]
        native_imperv = _imperv[row_min : row_max + 1, col_min : col_max + 1]
        canopy_grid = _aggregate_grid(native_canopy, factor, "mean")
        imperv_grid = _aggregate_grid(native_imperv, factor, "mean")

        job_store.set_progress(job_id, 5)
        if job_store.is_cancelled(job_id):
            return

        catalog = load_tree_catalog_map()
        selected_options = []
        for option_id in request.tree_option_ids:
            option = catalog.get(option_id)
            if option is None:
                raise ValueError(f"Unknown tree option '{option_id}'.")
            selected_options.append(option)

        selected_regions = {}
        region_requirements = {}
        for region in request.selected_regions:
            cells = _region_cells_from_polygon(
                region.polygon,
                row_min,
                row_max,
                col_min,
                col_max,
                factor,
            )
            selected_regions[region.id] = cells
            region_requirements[region.id] = {
                "total_trees_exact": region.total_trees_exact,
                "total_trees_min": region.total_trees_min,
                "total_trees_max": region.total_trees_max,
            }

        tree_ids = [option.tree_option_id for option in selected_options]
        solution = forestry_mip(
            budget=request.budget,
            canopy_grid=canopy_grid,
            imperv_grid=imperv_grid,
            tree_type_names=tree_ids,
            tree_cost_dict={option.tree_option_id: option.cost_usd for option in selected_options},
            tree_canopy_gain_dict={
                option.tree_option_id: option.canopy_gain for option in selected_options
            },
            tree_inventory_limit_dict={
                option.tree_option_id: option.inventory for option in selected_options
            },
            selected_regions=selected_regions,
            region_requirements=region_requirements,
            max_trees_per_site=100 * (factor ** 2),
        )

        job_store.set_progress(job_id, 90)
        x_sol = solution["x_sol"]
        y_sol = solution["y_sol"]
        cells: list[CellResult] = []
        total_cooling = 0.0
        site_cost = 20.0

        if x_sol is not None and y_sol is not None:
            hi1 = np.where(
                imperv_grid < 0.25,
                0.75 / 100.0,
                np.where(imperv_grid < 0.50, 0.30 / 100.0, 0.10 / 100.0),
            )
            hi2 = np.where(
                imperv_grid < 0.25,
                2.00 / 100.0,
                np.where(imperv_grid < 0.50, 2.50 / 100.0, 1.80 / 100.0),
            )
            beta = 1.0 + 0.75 * imperv_grid

            planted_rows, planted_cols = np.where(y_sol > 0.5)
            for i, j in zip(planted_rows, planted_cols):
                tree_counts = {}
                total_trees = 0
                canopy_gain = 0.0
                tree_cost = 0.0

                for k, option in enumerate(selected_options):
                    count = int(max(0, round(float(x_sol[i, j, k]))))
                    if count <= 0:
                        continue
                    tree_counts[option.tree_option_id] = count
                    total_trees += count
                    canopy_gain += option.canopy_gain * count
                    tree_cost += option.cost_usd * count

                if total_trees == 0:
                    continue

                cell_cooling = 100.0 * (
                    beta[i, j]
                    * (
                        hi1[i, j] * min(canopy_gain, max(0.40 - float(canopy_grid[i, j]), 0.0))
                        + hi2[i, j]
                        * max(
                            0.0,
                            canopy_gain - min(canopy_gain, max(0.40 - float(canopy_grid[i, j]), 0.0)),
                        )
                    )
                )
                total_cooling += cell_cooling

                full_row_start = row_min + i * factor
                full_col_start = col_min + j * factor
                full_row_end = min(row_min + (i + 1) * factor - 1, row_max)
                full_col_end = min(col_min + (j + 1) * factor - 1, col_max)
                lng, lat, bbox = _aggregated_cell_geometry(
                    full_row_start,
                    full_row_end,
                    full_col_start,
                    full_col_end,
                )
                dominant = max(tree_counts.items(), key=lambda item: item[1])[0]

                cells.append(
                    CellResult(
                        lng=lng,
                        lat=lat,
                        bbox=bbox,
                        tree_counts=tree_counts,
                        total_trees=total_trees,
                        total_cost=round(tree_cost + site_cost, 2),
                        cooling_delta=round(cell_cooling, 4),
                        canopy_gain=round(canopy_gain, 4),
                        imperviousness=round(float(imperv_grid[i, j]), 3),
                        dominant_tree_option_id=dominant,
                    )
                )

        runtime = round(time.time() - start, 2)
        summary = OptimizeSummary(
            status=solution["status"].lower(),
            runtime_s=runtime,
            cell_size_m=request.cell_size_m,
            total_cells=len(cells),
            total_trees=solution["total_trees"],
            budget_used=round(solution["total_cost"], 2),
            budget_remaining=round(request.budget - solution["total_cost"], 2),
            total_cooling_delta=round(total_cooling, 4),
            trees_by_type=solution["trees_by_type"],
            regions=[
                RegionSummary(
                    id=region.id,
                    name=region.name,
                    total_trees=solution["region_tree_totals"].get(region.id, 0),
                )
                for region in request.selected_regions
            ],
        )
        job_store.set_complete(job_id, OptimizeResult(summary=summary, cells=cells))
    except Exception as exc:
        job_store.set_failed(job_id, str(exc))
        raise
