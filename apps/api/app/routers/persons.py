import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Person, Subscription, User
from app.schemas import PersonDetail
from app.security import get_current_user

router = APIRouter(prefix="/persons", tags=["persons"])


def _consume_credit(db: Session, user: User) -> None:
    subscription = (
        db.query(Subscription)
        .filter(Subscription.user_id == user.id, Subscription.status == "active", Subscription.credits_remaining > 0)
        .order_by(Subscription.created_at.desc())
        .first()
    )
    if subscription is None:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="No report credits remaining — purchase a report or subscription to view full details.",
        )
    subscription.credits_remaining -= 1
    db.commit()


@router.get("/{person_id}", response_model=PersonDetail)
def get_person(
    person_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Person:
    person = db.get(Person, person_id)
    if person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")

    _consume_credit(db, current_user)
    return person
