import time

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Person, SearchAuditLog
from app.schemas import PersonSummary, SearchResponse
from app.search_index import search_persons

router = APIRouter(prefix="/search", tags=["search"])
settings = get_settings()


def query_people(
    db: Session,
    first_name: str,
    last_name: str,
    state: str | None,
    city: str | None,
) -> list[Person]:
    try:
        person_ids = search_persons(first_name, last_name, state=state, city=city)
        people = db.query(Person).filter(Person.id.in_(person_ids)).all() if person_ids else []
        if people:
            return people
    except Exception:
        pass

    query = db.query(Person).filter(
        Person.first_name.ilike(f"%{first_name}%"),
        Person.last_name.ilike(f"%{last_name}%"),
    )
    if state:
        query = query.filter(Person.addresses.any(state=state.upper()))
    if city:
        query = query.filter(Person.addresses.any(city=city))
    return query.limit(25).all()


def enqueue_scrape(first_name: str, last_name: str, state: str | None) -> str:
    try:
        response = httpx.post(
            f"{settings.scraper_service_url}/jobs",
            json={"firstName": first_name, "lastName": last_name, "state": state},
            timeout=5.0,
        )
        response.raise_for_status()
        return response.json()["jobId"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public-record ingestion is temporarily unavailable",
        ) from exc


def scrape_job_state(job_id: str) -> tuple[str, str | None]:
    try:
        response = httpx.get(f"{settings.scraper_service_url}/jobs/{job_id}", timeout=5.0)
        response.raise_for_status()
        body = response.json()
        return body["state"], body.get("failedReason")
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public-record ingestion status is temporarily unavailable",
        ) from exc


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

    people = query_people(db, first_name, last_name, state, city)
    scrape_status = "complete"
    if not people:
        job_id = enqueue_scrape(first_name, last_name, state)
        deadline = time.monotonic() + settings.scraper_wait_seconds
        while time.monotonic() < deadline:
            time.sleep(0.5)
            db.expire_all()
            people = query_people(db, first_name, last_name, state, city)
            if people:
                break
            job_state, failure = scrape_job_state(job_id)
            if job_state == "completed":
                break
            if job_state == "failed":
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=failure or "Public-record providers failed",
                )
        else:
            scrape_status = "processing"

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
    return SearchResponse(total=len(results), results=results, status=scrape_status)
