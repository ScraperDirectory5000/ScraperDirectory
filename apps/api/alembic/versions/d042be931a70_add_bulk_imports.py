"""add bulk imports

Revision ID: d042be931a70
Revises: c31a7d02f641
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d042be931a70"
down_revision: str | None = "c31a7d02f641"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("persons", sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("court_records", sa.Column("source", sa.String(length=120), nullable=True))
    op.create_table(
        "bulk_import_runs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(length=120), nullable=False),
        sa.Column("dataset_version", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("cursor", sa.String(length=500), nullable=True),
        sa.Column("source_rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("accepted_rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("rejected_rows", sa.Integer(), server_default="0", nullable=False),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "dataset_version", name="uq_bulk_import_source_version"),
    )
    op.create_index("ix_bulk_import_runs_source", "bulk_import_runs", ["source"])
    op.create_table(
        "bulk_person_staging",
        sa.Column("run_id", sa.UUID(), nullable=False),
        sa.Column("person_id", sa.UUID(), nullable=False),
        sa.Column("external_id", sa.String(length=500), nullable=False),
        sa.Column("source_record_id", sa.String(length=500), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=False),
        sa.Column("middle_name", sa.String(length=100), nullable=True),
        sa.Column("last_name", sa.String(length=100), nullable=False),
        sa.Column("dob_year", sa.Integer(), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("state", sa.String(length=2), nullable=True),
        sa.Column("zip_code", sa.String(length=10), nullable=True),
        sa.Column("record_number", sa.String(length=80), nullable=True),
        sa.Column("record_type", sa.String(length=80), nullable=False),
        sa.Column("record_title", sa.String(length=200), nullable=False),
        sa.Column("record_status", sa.String(length=80), nullable=False),
        sa.Column("record_description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["bulk_import_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id", "source_record_id"),
    )


def downgrade() -> None:
    op.drop_table("bulk_person_staging")
    op.drop_index("ix_bulk_import_runs_source", table_name="bulk_import_runs")
    op.drop_table("bulk_import_runs")
    op.drop_column("court_records", "source")
    op.drop_column("persons", "is_active")