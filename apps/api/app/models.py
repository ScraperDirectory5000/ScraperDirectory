import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    subscriptions: Mapped[list["Subscription"]] = relationship(back_populates="user")
    payments: Mapped[list["Payment"]] = relationship(back_populates="user")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    plan: Mapped[str] = mapped_column(String(50))  # e.g. "single_report", "monthly_unlimited"
    status: Mapped[str] = mapped_column(String(20), default="active")  # active, canceled, past_due
    credits_remaining: Mapped[int] = mapped_column(Integer, default=0)
    provider: Mapped[str] = mapped_column(String(30), default="paypal")
    provider_subscription_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    renews_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="subscriptions")


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    provider: Mapped[str] = mapped_column(String(30), default="paypal")
    provider_payment_id: Mapped[str] = mapped_column(String(120), unique=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    status: Mapped[str] = mapped_column(String(20))  # created, completed, refunded, failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="payments")


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[uuid.UUID] = uuid_pk()
    first_name: Mapped[str] = mapped_column(String(100), index=True)
    middle_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str] = mapped_column(String(100), index=True)
    dob_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    age_estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    addresses: Mapped[list["Address"]] = relationship(back_populates="person", cascade="all, delete-orphan")
    phones: Mapped[list["Phone"]] = relationship(back_populates="person", cascade="all, delete-orphan")
    emails: Mapped[list["Email"]] = relationship(back_populates="person", cascade="all, delete-orphan")
    usernames: Mapped[list["Username"]] = relationship(back_populates="person", cascade="all, delete-orphan")
    social_profiles: Mapped[list["SocialProfile"]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )
    court_records: Mapped[list["CourtRecord"]] = relationship(back_populates="person", cascade="all, delete-orphan")
    life_events: Mapped[list["LifeEvent"]] = relationship(back_populates="person", cascade="all, delete-orphan")
    relationship_claims: Mapped[list["RelationshipClaim"]] = relationship(
        back_populates="person", cascade="all, delete-orphan"
    )


class PersonSourceIdentity(Base):
    __tablename__ = "person_source_identities"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_person_source_identity"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(120))
    external_id: Mapped[str] = mapped_column(String(500))


class RelativeLink(Base):
    __tablename__ = "relative_links"
    __table_args__ = (UniqueConstraint("person_id", "related_person_id", name="uq_relative_pair"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    related_person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    relation_type: Mapped[str | None] = mapped_column(String(50), nullable=True)  # spouse, parent, sibling, assoc.
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)


class LifeEvent(Base):
    __tablename__ = "life_events"
    __table_args__ = (
        UniqueConstraint("person_id", "source", "source_record_id", "event_type", name="uq_life_event_evidence"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(30))
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    locality: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(120))
    source_record_id: Mapped[str] = mapped_column(String(500))
    source_url: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Numeric(3, 2))

    person: Mapped["Person"] = relationship(back_populates="life_events")


class RelationshipClaim(Base):
    __tablename__ = "relationship_claims"
    __table_args__ = (
        UniqueConstraint(
            "person_id",
            "source",
            "source_record_id",
            "relation_type",
            "related_first_name",
            "related_last_name",
            name="uq_relationship_claim_evidence",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    relation_type: Mapped[str] = mapped_column(String(30))
    related_first_name: Mapped[str] = mapped_column(String(100))
    related_middle_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    related_last_name: Mapped[str] = mapped_column(String(100))
    event_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(120))
    source_record_id: Mapped[str] = mapped_column(String(500))
    source_url: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Numeric(3, 2))

    person: Mapped["Person"] = relationship(back_populates="relationship_claims")


class Address(Base):
    __tablename__ = "addresses"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    line1: Mapped[str] = mapped_column(String(255))
    line2: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    zip_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    first_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_seen: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)

    person: Mapped["Person"] = relationship(back_populates="addresses")


class Phone(Base):
    __tablename__ = "phones"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    number: Mapped[str] = mapped_column(String(20), index=True)
    phone_type: Mapped[str | None] = mapped_column(String(20), nullable=True)  # mobile, landline, voip
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)

    person: Mapped["Person"] = relationship(back_populates="phones")


class Email(Base):
    __tablename__ = "emails"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    email: Mapped[str] = mapped_column(String(255), index=True)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)

    person: Mapped["Person"] = relationship(back_populates="emails")


class Username(Base):
    __tablename__ = "usernames"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    username: Mapped[str] = mapped_column(String(120), index=True)
    platform_guess: Mapped[str | None] = mapped_column(String(60), nullable=True)
    confidence: Mapped[float] = mapped_column(Numeric(3, 2), default=0.5)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)

    person: Mapped["Person"] = relationship(back_populates="usernames")


class SocialProfile(Base):
    """Publicly discovered profile URL only — never populated via authenticated scraping."""

    __tablename__ = "social_profiles"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    platform: Mapped[str] = mapped_column(String(60))  # facebook, linkedin, x, instagram
    url: Mapped[str] = mapped_column(Text)
    discovered_via: Mapped[str | None] = mapped_column(String(120), nullable=True)
    confidence: Mapped[float] = mapped_column(Numeric(3, 2), default=0.5)

    person: Mapped["Person"] = relationship(back_populates="social_profiles")


class CourtRecord(Base):
    __tablename__ = "court_records"

    id: Mapped[uuid.UUID] = uuid_pk()
    person_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("persons.id"))
    case_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    court_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    state: Mapped[str | None] = mapped_column(String(2), nullable=True)
    case_type: Mapped[str | None] = mapped_column(String(80), nullable=True)  # civil, criminal, traffic
    filing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    disposition: Mapped[str | None] = mapped_column(String(200), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)

    person: Mapped["Person"] = relationship(back_populates="court_records")


class RecordSource(Base):
    __tablename__ = "record_sources"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), unique=True)
    base_url: Mapped[str] = mapped_column(Text)
    jurisdiction: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_type: Mapped[str] = mapped_column(String(50))  # court, property, business, license, npi, corrections
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class BulkImportRun(Base):
    __tablename__ = "bulk_import_runs"
    __table_args__ = (
        UniqueConstraint("source", "dataset_version", name="uq_bulk_import_source_version"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    source: Mapped[str] = mapped_column(String(120), index=True)
    dataset_version: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20))
    cursor: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_rows: Mapped[int] = mapped_column(Integer, default=0)
    accepted_rows: Mapped[int] = mapped_column(Integer, default=0)
    rejected_rows: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ScrapeJob(Base):
    __tablename__ = "scrape_jobs"

    id: Mapped[uuid.UUID] = uuid_pk()
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("record_sources.id"))
    target: Mapped[str] = mapped_column(Text)  # query/URL/params used for this job
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued, running, success, failed
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SearchAuditLog(Base):
    __tablename__ = "search_audit_log"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    query: Mapped[str] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    searched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OptOutRequest(Base):
    __tablename__ = "optout_requests"

    id: Mapped[uuid.UUID] = uuid_pk()
    full_name: Mapped[str] = mapped_column(String(200))
    email_or_details: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, completed, rejected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
