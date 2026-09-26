from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import BulkImportRun
from app.schemas import BulkSourceStatus

router = APIRouter(prefix="/sources", tags=["sources"])


@router.get("", response_model=list[BulkSourceStatus])
def source_status(db: Session = Depends(get_db)) -> list[BulkImportRun]:
    runs = db.query(BulkImportRun).order_by(BulkImportRun.started_at.desc()).all()
    latest: dict[str, BulkImportRun] = {}
    for run in runs:
        latest.setdefault(run.source, run)
    return list(latest.values())