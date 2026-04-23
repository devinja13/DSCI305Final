from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from api.routers.optimize import router
from api.model import load_raster_data


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_raster_data()   # loads GeoTIFFs once at startup
    yield


app = FastAPI(title="DLAB Forestry API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
