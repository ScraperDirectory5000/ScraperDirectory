import time

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Person, SearchAuditLog
from app.schemas import PersonSummary, ProviderProgress, SearchResponse
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
        state_matches = query.filter(
            or_(
                Person.addresses.any(state=state.upper()),
                Person.court_records.any(state=state.upper()),
            )
        )
        if city:
            state_matches = state_matches.filter(Person.addresses.any(city=city))
        people = state_matches.limit(25).all()
        if people:
            return people
        return query.limit(25).all()
    if city:
        city_matches = query.filter(Person.addresses.any(city=city)).limit(25).all()
        if city_matches:
            return city_matches
        return query.limit(25).all()
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


def scrape_job_state(
    job_id: str,
) -> tuple[str, str | None, list[str], dict[str, ProviderProgress]]:
    try:
        response = httpx.get(f"{settings.scraper_service_url}/jobs/{job_id}", timeout=5.0)
        response.raise_for_status()
        body = response.json()
        provider_progress = {
            name: ProviderProgress.model_validate(progress)
            for name, progress in body.get("progress", {}).get("providers", {}).items()
        }
        return body["state"], body.get("failedReason"), body.get("failures", []), provider_progress
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public-record ingestion status is temporarily unavailable",
        ) from exc


def summarize_people(people: list[Person]) -> list[PersonSummary]:
    return [
        PersonSummary(
            id=person.id,
            first_name=person.first_name,
            middle_name=person.middle_name,
            last_name=person.last_name,
            age_estimate=person.age_estimate,
            cities=sorted({address.city for address in person.addresses if address.city}),
            states=sorted(
                {address.state for address in person.addresses if address.state}
                | {record.state for record in person.court_records if record.state}
            ),
        )
        for person in people
    ]


def response_status(job_state: str, provider_failures: list[str]) -> str:
    if job_state == "completed":
        return "partial" if provider_failures else "complete"
    if job_state == "failed":
        return "partial"
    return "processing"


def location_filter_relaxed(
    people: list[Person],
    state: str | None,
    city: str | None,
) -> bool:
    if not people or not (state or city):
        return False
    for person in people:
        state_matches = not state or any(
            address.state == state.upper() for address in person.addresses
        ) or any(record.state == state.upper() for record in person.court_records)
        city_matches = not city or any(
            address.city and address.city.lower() == city.lower() for address in person.addresses
        )
        if state_matches and city_matches:
            return False
    return True


@router.get("/status/{job_id}", response_model=SearchResponse)
def search_status(
    job_id: str,
    first_name: str,
    last_name: str,
    state: str | None = None,
    city: str | None = None,
    db: Session = Depends(get_db),
) -> SearchResponse:
    job_state, failure, provider_failures, provider_progress = scrape_job_state(job_id)
    db.expire_all()
    people = query_people(db, first_name, last_name, state, city)
    if job_state == "failed" and not people:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=failure or "Public-record providers failed",
        )
    results = summarize_people(people)
    return SearchResponse(
        total=len(results),
        results=results,
        status=response_status(job_state, provider_failures),
        provider_failures=provider_failures,
        provider_progress=provider_progress,
        job_id=job_id,
        location_filter_relaxed=location_filter_relaxed(people, state, city),
    )


@router.get("", response_model=SearchResponse)
def search(
    request: Request,
    first_name: str,
    last_name: str,
    state: str | None = None,
    city: str | None = None,
    wait: bool = True,
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
    job_id = enqueue_scrape(first_name, last_name, state)
    scrape_status = "complete"
    provider_failures: list[str] = []
    provider_progress: dict[str, ProviderProgress] = {}
    if not wait:
        job_state, _, provider_failures, provider_progress = scrape_job_state(job_id)
        results = summarize_people(people)
        return SearchResponse(
            total=len(results),
            results=results,
            status=response_status(job_state, provider_failures),
            provider_failures=provider_failures,
            provider_progress=provider_progress,
            job_id=job_id,
            location_filter_relaxed=location_filter_relaxed(people, state, city),
        )

    if not people:
        deadline = time.monotonic() + settings.scraper_wait_seconds
        while time.monotonic() < deadline:
            job_state, failure, provider_failures, provider_progress = scrape_job_state(job_id)
            if job_state == "completed":
                db.expire_all()
                people = query_people(db, first_name, last_name, state, city)
                if provider_failures:
                    scrape_status = "partial"
                break
            if job_state == "failed":
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=failure or "Public-record providers failed",
                )
            time.sleep(0.5)
        else:
            db.expire_all()
            people = query_people(db, first_name, last_name, state, city)
            scrape_status = "processing"
    else:
        job_state, _, provider_failures, provider_progress = scrape_job_state(job_id)
        if job_state in {"active", "delayed", "prioritized", "waiting", "waiting-children"}:
            scrape_status = "processing"
        elif job_state == "failed" or provider_failures:
            scrape_status = "partial"

    results = summarize_people(people)
    return SearchResponse(
        total=len(results),
        results=results,
        status=scrape_status,
        provider_failures=provider_failures,
        provider_progress=provider_progress,
        job_id=job_id,
        location_filter_relaxed=location_filter_relaxed(people, state, city),
    )
