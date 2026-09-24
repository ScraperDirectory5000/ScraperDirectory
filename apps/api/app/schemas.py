import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr


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


class SearchRequest(BaseModel):
    first_name: str
    last_name: str
    state: str | None = None
    city: str | None = None


class SearchResponse(BaseModel):
    total: int
    results: list[PersonSummary]


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
