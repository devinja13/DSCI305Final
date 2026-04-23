from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional
import uuid

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    failed = "failed"
    cancelled = "cancelled"


class RegionBbox(BaseModel):
    west: float
    south: float
    east: float
    north: float


class RegionPoint(BaseModel):
    lng: float
    lat: float


class RegionConstraintRequest(BaseModel):
    id: str
    name: str
    polygon: list[RegionPoint] = Field(min_length=3)
    total_trees_exact: Optional[int] = Field(default=None, ge=0)
    total_trees_min: Optional[int] = Field(default=None, ge=0)
    total_trees_max: Optional[int] = Field(default=None, ge=0)


class OptimizeRequest(BaseModel):
    budget: float = Field(gt=0)
    tree_option_ids: list[str] = Field(min_length=1)
    region: RegionBbox
    selected_regions: list[RegionConstraintRequest] = Field(default_factory=list)
    cell_size_m: int = Field(default=100)


class TreeOption(BaseModel):
    tree_option_id: str
    common_name: str
    scientific_name: str
    size_label: str
    size_gallon: Optional[float] = None
    size_caliper_inches: Optional[float] = None
    size_classification: str
    estimated_diameter_m: float
    estimated_canopy_m: float
    cost_usd: float
    inventory: int
    canopy_gain: float


class CellResult(BaseModel):
    lng: float
    lat: float
    bbox: list[float]
    tree_counts: dict[str, int]
    total_trees: int
    total_cost: float
    cooling_delta: float
    canopy_gain: float
    imperviousness: float
    dominant_tree_option_id: Optional[str] = None


class RegionSummary(BaseModel):
    id: str
    name: str
    total_trees: int


class OptimizeSummary(BaseModel):
    status: str
    runtime_s: float
    cell_size_m: int
    total_cells: int
    total_trees: int
    budget_used: float
    budget_remaining: float
    total_cooling_delta: float
    trees_by_type: dict[str, int]
    regions: list[RegionSummary] = Field(default_factory=list)


class OptimizeResult(BaseModel):
    summary: OptimizeSummary
    cells: list[CellResult]


@dataclass
class Job:
    job_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: JobStatus = JobStatus.pending
    created_at: datetime = field(default_factory=datetime.utcnow)
    progress: int = 0
    result: Optional[OptimizeResult] = None
    error: Optional[str] = None


class SubmitResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: int
    result: Optional[OptimizeResult] = None
    error: Optional[str] = None
