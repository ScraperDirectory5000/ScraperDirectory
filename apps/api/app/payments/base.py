from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class CreatedOrder:
    provider_order_id: str
    approve_url: str | None


@dataclass
class CapturedOrder:
    provider_order_id: str
    status: str  # "COMPLETED", "FAILED", etc.
    amount_cents: int
    currency: str


class PaymentProvider(ABC):
    """Common interface so PayPal can be swapped for another processor later
    without touching the routers or credit-granting business logic."""

    @abstractmethod
    def create_order(self, amount_cents: int, currency: str, description: str) -> CreatedOrder: ...

    @abstractmethod
    def capture_order(self, provider_order_id: str) -> CapturedOrder: ...
