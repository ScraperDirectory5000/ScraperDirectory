import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class AddressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    line1: str
    line2: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    first_seen: date | None = None
    last_seen: date | None = None
    source: str | None = None


class PhoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    number: str
    phone_type: str | None = None
    source: str | None = None


class EmailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    email: str
    source: str | None = None


class UsernameOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    username: str
    platform_guess: str | None = None
    confidence: float


class SocialProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    platform: str
    url: str
    discovered_via: str | None = None
    confidence: float


class CourtRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    case_number: str | None = None
    court_name: str | None = None
    state: str | None = None
    case_type: str | None = None
    filing_date: date | None = None
    disposition: str | None = None
    source_url: str | None = None


class LifeEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    event_type: str
    event_date: date | None = None
    state: str | None = None
    locality: str | None = None
    description: str | None = None
    source: str
    source_record_id: str
    source_url: str
    confidence: float


class RelationshipClaimOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    relation_type: str
    related_first_name: str
    related_middle_name: str | None = None
    related_last_name: str
    event_date: date | None = None
    source: str
    source_record_id: str
    source_url: str
    confidence: float


class PersonSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    first_name: str
    middle_name: str | None = None
    last_name: str
    age_estimate: int | None = None
    cities: list[str] = []
    states: list[str] = []


class PersonDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    first_name: str
    middle_name: str | None = None
    last_name: str
    dob_year: int | None = None
    age_estimate: int | None = None
    addresses: list[AddressOut] = []
    phones: list[PhoneOut] = []
    emails: list[EmailOut] = []
    usernames: list[UsernameOut] = []
    social_profiles: list[SocialProfileOut] = []
    court_records: list[CourtRecordOut] = []
    life_events: list[LifeEventOut] = []
    relationship_claims: list[RelationshipClaimOut] = []


class SearchRequest(BaseModel):
    first_name: str
    last_name: str
    state: str | None = None
    city: str | None = None


class ProviderProgress(BaseModel):
    status: str = "waiting"
    records: int = 0


class BulkSourceStatus(BaseModel):
    source: str
    dataset_version: str
    status: str
    source_rows: int
    accepted_rows: int
    rejected_rows: int
    started_at: datetime
    finished_at: datetime | None = None
    error: str | None = None


class SearchResponse(BaseModel):
    total: int
    results: list[PersonSummary]
    status: str = "complete"
    provider_failures: list[str] = Field(default_factory=list)
    provider_progress: dict[str, ProviderProgress] = Field(default_factory=dict)
    job_id: str | None = None
    location_filter_relaxed: bool = False


class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: EmailStr
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class OptOutCreate(BaseModel):
    full_name: str
    email_or_details: str
