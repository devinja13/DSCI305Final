# DLAB Forestry

DLAB Forestry is a two-part web application for exploring urban tree-planting scenarios in Houston:

- A `FastAPI` backend that loads raster data, tree inventory metadata, and runs a Gurobi optimization model
- A `Vite + React + TypeScript` frontend that lets users choose tree types, budget, cell size, and constrained planting regions

The repo has been cleaned down to the files needed to run the website and the current optimization model.

## Repo Structure

```text
api/                 FastAPI app, API models, job store, optimizer entrypoints
gurobi-model/        Raster inputs required by the optimization model
ui/                  React frontend
requirements.txt     Python dependencies for the backend
README.md            Project documentation
```

## What The Model Does

The backend optimization model:

- clips the raster inputs to the requested map region
- aggregates the raster grid to `50m`, `100m`, or `200m` cells
- filters out cells above the imperviousness threshold
- chooses how many trees of each selected type to place in each eligible cell
- respects budget, inventory, per-site capacity, and optional user-defined region constraints
- maximizes an estimated cooling objective derived from canopy gain and imperviousness

## Runtime Requirements

You need:

- Python 3.11+
- Node.js 18+
- a valid `gurobi.lic` available to `gurobipy`

The backend depends on the raster files in [gurobi-model](/Users/devin/Desktop/DSCI305/DSCI305Final/gurobi-model) and the tree catalog in [api/treedata.csv](/Users/devin/Desktop/DSCI305/DSCI305Final/api/treedata.csv).

## Backend Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn api.main:app --reload
```

The API runs at [http://localhost:8000](http://localhost:8000). Health check:

```bash
curl http://localhost:8000/health
```

## Frontend Setup

```bash
cd ui
npm install
npm run dev
```

The frontend runs at [http://localhost:5173](http://localhost:5173) and talks to the backend at `http://localhost:8000/api`.

## Main API Endpoints

- `GET /health`
- `GET /api/tree-options`
- `POST /api/optimize`
- `GET /api/job/{job_id}`
- `DELETE /api/job/{job_id}`

## Model Inputs

User request inputs:

- budget
- selected tree option ids
- bounding region
- optional constrained polygons with exact/min/max tree counts
- cell size

Static project inputs:

- canopy raster: `gurobi-model/ForUSTree_2018_HighVeg_TreeCoverage.tif`
- imperviousness raster: `gurobi-model/texas_clipped.tif`
- tree catalog: `api/treedata.csv`

## Model Risks And Limitations

This model is useful for scenario planning, but it should not be treated as a field-ready planting prescription without review.

- The cooling objective is modeled, not observed. It is based on canopy-growth assumptions and hardcoded coefficients, so outputs are only as reliable as those assumptions.
- Results are sensitive to raster quality and coverage. If the source rasters are outdated, misaligned, or incomplete, recommendations can be wrong.
- The optimizer works on aggregated cells, not exact parcels or planting sites. A recommended cell does not guarantee a tree can be planted everywhere inside it.
- Region constraints use polygon-to-cell assignment based on aggregated cell geometry and centroid-style checks, which can include or exclude edge cells imperfectly.
- Tree inventory, canopy gain, and cost values come from the local CSV catalog. If those values drift from real inventory or procurement costs, the plan can become infeasible in practice.
- The solver may return `TIME_LIMIT`, `INFEASIBLE`, or a best-found solution instead of a proven optimum, especially for large areas or fine cell sizes.
- The backend keeps jobs only in memory. Restarting the API clears job history, and multi-process deployment would need a shared job store.
- The app currently assumes local development defaults, including a frontend origin of `http://localhost:5173` for CORS.
- There is no authentication, authorization, or persistence layer in the current app, so it is not production-hardened as-is.

## Notes For Future Work

Good next improvements would be:

- move API base URLs and allowed origins into environment variables
- persist jobs in Redis or a database
- version the raster and tree-catalog inputs
- validate recommendations against parcel, land-use, and utility constraints
- add automated tests for optimization requests and frontend API flows
