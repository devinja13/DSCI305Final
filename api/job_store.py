from api.models import Job, JobStatus, OptimizeResult
from typing import Optional

# Module-level in-memory store. Single-process FastAPI — this is safe.
_jobs: dict[str, Job] = {}


def create_job() -> Job:
    job = Job()
    _jobs[job.job_id] = job
    return job

def get_job(job_id: str) -> Optional[Job]:
    return _jobs.get(job_id)

def set_running(job_id: str):
    if job_id in _jobs:
        _jobs[job_id].status = JobStatus.running

def set_progress(job_id: str, progress: int):
    if job_id in _jobs:
        _jobs[job_id].progress = progress

def set_complete(job_id: str, result: OptimizeResult):
    if job_id in _jobs:
        _jobs[job_id].status = JobStatus.complete
        _jobs[job_id].progress = 100
        _jobs[job_id].result = result

def set_failed(job_id: str, error: str):
    if job_id in _jobs:
        _jobs[job_id].status = JobStatus.failed
        _jobs[job_id].error = error

def set_cancelled(job_id: str):
    if job_id in _jobs:
        _jobs[job_id].status = JobStatus.cancelled

def is_cancelled(job_id: str) -> bool:
    job = _jobs.get(job_id)
    return job is not None and job.status == JobStatus.cancelled
