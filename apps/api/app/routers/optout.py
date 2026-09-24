from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import OptOutRequest
from app.schemas import OptOutCreate

router = APIRouter(prefix="/optout", tags=["optout"])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_optout_request(payload: OptOutCreate, db: Session = Depends(get_db)) -> dict:
    record = OptOutRequest(full_name=payload.full_name, email_or_details=payload.email_or_details)
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"id": str(record.id), "status": record.status}
