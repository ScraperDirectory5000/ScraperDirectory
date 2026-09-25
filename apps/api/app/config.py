from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://unnamedfiles:change-me-locally@localhost:5432/unnamedfiles"
    redis_url: str = "redis://localhost:6379/0"
    opensearch_url: str = "http://localhost:9200"
    opensearch_index: str = "persons"
    scraper_service_url: str = "http://localhost:3001"
    scraper_wait_seconds: float = 20.0

    jwt_secret: str = "change-me-to-a-long-random-value"
    jwt_algorithm: str = "HS256"
    jwt_expires_minutes: int = 60

    api_cors_origins: str = "http://localhost:3000"

    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_mode: str = "sandbox"
    paypal_webhook_id: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]

    @property
    def paypal_base_url(self) -> str:
        if self.paypal_mode == "live":
            return "https://api-m.paypal.com"
        return "https://api-m.sandbox.paypal.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
