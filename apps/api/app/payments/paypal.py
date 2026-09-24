import httpx

from app.config import get_settings
from app.payments.base import CapturedOrder, CreatedOrder, PaymentProvider

settings = get_settings()


class PayPalProvider(PaymentProvider):
    """PayPal Orders v2 integration (sandbox by default via PAYPAL_MODE)."""

    def __init__(self) -> None:
        self._token: str | None = None

    def _get_access_token(self) -> str:
        if self._token:
            return self._token
        response = httpx.post(
            f"{settings.paypal_base_url}/v1/oauth2/token",
            data={"grant_type": "client_credentials"},
            auth=(settings.paypal_client_id, settings.paypal_client_secret),
            timeout=15,
        )
        response.raise_for_status()
        self._token = response.json()["access_token"]
        return self._token

    def create_order(self, amount_cents: int, currency: str, description: str) -> CreatedOrder:
        token = self._get_access_token()
        amount_value = f"{amount_cents / 100:.2f}"
        response = httpx.post(
            f"{settings.paypal_base_url}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "description": description,
                        "amount": {"currency_code": currency, "value": amount_value},
                    }
                ],
            },
            timeout=15,
        )
        response.raise_for_status()
        body = response.json()
        approve_url = next(
            (link["href"] for link in body.get("links", []) if link.get("rel") == "approve"), None
        )
        return CreatedOrder(provider_order_id=body["id"], approve_url=approve_url)

    def capture_order(self, provider_order_id: str) -> CapturedOrder:
        token = self._get_access_token()
        response = httpx.post(
            f"{settings.paypal_base_url}/v2/checkout/orders/{provider_order_id}/capture",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        response.raise_for_status()
        body = response.json()
        capture = body["purchase_units"][0]["payments"]["captures"][0]
        return CapturedOrder(
            provider_order_id=body["id"],
            status=body["status"],
            amount_cents=round(float(capture["amount"]["value"]) * 100),
            currency=capture["amount"]["currency_code"],
        )
