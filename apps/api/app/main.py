from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import auth, optout, payments, persons, search

settings = get_settings()

app = FastAPI(title="Unnamed Files API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(search.router)
app.include_router(persons.router)
app.include_router(payments.router)
app.include_router(optout.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
