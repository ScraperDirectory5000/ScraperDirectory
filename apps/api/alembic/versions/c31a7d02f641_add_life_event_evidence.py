"""add life event evidence

Revision ID: c31a7d02f641
Revises: a8f4c2d91e30
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c31a7d02f641"
down_revision: str | None = "a8f4c2d91e30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "life_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("person_id", sa.UUID(), nullable=False),
        sa.Column("event_type", sa.String(length=30), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("state", sa.String(length=2), nullable=True),
        sa.Column("locality", sa.String(length=200), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=120), nullable=False),
        sa.Column("source_record_id", sa.String(length=500), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Numeric(precision=3, scale=2), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "person_id", "source", "source_record_id", "event_type", name="uq_life_event_evidence"
        ),
    )
    op.create_index("ix_life_events_person_id", "life_events", ["person_id"])

    op.create_table(
        "relationship_claims",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("person_id", sa.UUID(), nullable=False),
        sa.Column("relation_type", sa.String(length=30), nullable=False),
        sa.Column("related_first_name", sa.String(length=100), nullable=False),
        sa.Column("related_middle_name", sa.String(length=100), nullable=True),
        sa.Column("related_last_name", sa.String(length=100), nullable=False),
        sa.Column("event_date", sa.Date(), nullable=True),
        sa.Column("source", sa.String(length=120), nullable=False),
        sa.Column("source_record_id", sa.String(length=500), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Numeric(precision=3, scale=2), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "person_id",
            "source",
            "source_record_id",
            "relation_type",
            "related_first_name",
            "related_last_name",
            name="uq_relationship_claim_evidence",
        ),
    )
    op.create_index("ix_relationship_claims_person_id", "relationship_claims", ["person_id"])


def downgrade() -> None:
    op.drop_index("ix_relationship_claims_person_id", table_name="relationship_claims")
    op.drop_table("relationship_claims")
    op.drop_index("ix_life_events_person_id", table_name="life_events")
    op.drop_table("life_events")