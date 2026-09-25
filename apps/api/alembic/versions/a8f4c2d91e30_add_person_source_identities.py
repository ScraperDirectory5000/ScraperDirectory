"""add person source identities

Revision ID: a8f4c2d91e30
Revises: de5c763744ff
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a8f4c2d91e30"
down_revision: str | None = "de5c763744ff"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "person_source_identities",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("person_id", sa.UUID(), nullable=False),
        sa.Column("source", sa.String(length=120), nullable=False),
        sa.Column("external_id", sa.String(length=500), nullable=False),
        sa.ForeignKeyConstraint(["person_id"], ["persons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", "external_id", name="uq_person_source_identity"),
    )
    op.create_index("ix_person_source_identities_person_id", "person_source_identities", ["person_id"])


def downgrade() -> None:
    op.drop_index("ix_person_source_identities_person_id", table_name="person_source_identities")
    op.drop_table("person_source_identities")