from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Person, SearchAuditLog
from app.schemas import PersonSummary, SearchResponse
from app.search_index import search_persons

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=SearchResponse)
def search(
    request: Request,
    first_name: str,
    last_name: str,
    state: str | None = None,
    city: str | None = None,
    db: Session = Depends(get_db),
) -> SearchResponse:
    db.add(
        SearchAuditLog(
            query=f"{first_name} {last_name} state={state} city={city}",
            ip_address=request.client.host if request.client else None,
        )
    )
    db.commit()

    try:
        person_ids = search_persons(first_name, last_name, state=state, city=city)
        people = db.query(Person).filter(Person.id.in_(person_ids)).all() if person_ids else []
    except Exception:
        # OpenSearch unavailable in this environment — fall back to a direct DB scan.
        query = db.query(Person).filter(
            Person.first_name.ilike(f"%{first_name}%"),
            Person.last_name.ilike(f"%{last_name}%"),
        )
        if state:
            query = query.filter(Person.addresses.any(state=state.upper()))
        people = query.limit(25).all()

    results = [
        PersonSummary(
            id=p.id,
            first_name=p.first_name,
            middle_name=p.middle_name,
            last_name=p.last_name,
            age_estimate=p.age_estimate,
            cities=sorted({a.city for a in p.addresses if a.city}),
            states=sorted({a.state for a in p.addresses if a.state}),
        )
        for p in people
    ]
    return SearchResponse(total=len(results), results=results)
