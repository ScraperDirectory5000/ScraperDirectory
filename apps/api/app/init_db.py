"""Quick dev bootstrap: creates all tables directly from SQLAlchemy metadata.

For anything beyond local dev, generate a real Alembic migration instead:
    alembic revision --autogenerate -m "init schema"
    alembic upgrade head
"""

from app.db import Base, engine
from app import models  # noqa: F401  registers models on Base.metadata

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    print("Tables created.")
