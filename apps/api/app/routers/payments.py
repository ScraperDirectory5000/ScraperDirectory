from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Payment, Subscription, User
from app.payments.paypal import PayPalProvider
from app.security import get_current_user

router = APIRouter(prefix="/payments", tags=["payments"])

# Simple fixed pricing for now — a single report unlocks one person's full detail view.
REPORT_PRICE_CENTS = 495
REPORT_CURRENCY = "USD"


class CreateOrderResponse(BaseModel):
    provider_order_id: str
    approve_url: str | None


class CaptureOrderRequest(BaseModel):
    provider_order_id: str


class CaptureOrderResponse(BaseModel):
    status: str
    credits_remaining: int


def get_provider() -> PayPalProvider:
    return PayPalProvider()


@router.post("/orders", response_model=CreateOrderResponse)
def create_order(
    current_user: User = Depends(get_current_user),
    provider: PayPalProvider = Depends(get_provider),
) -> CreateOrderResponse:
    order = provider.create_order(REPORT_PRICE_CENTS, REPORT_CURRENCY, "Single person report")
    return CreateOrderResponse(provider_order_id=order.provider_order_id, approve_url=order.approve_url)


@router.post("/orders/capture", response_model=CaptureOrderResponse)
def capture_order(
    payload: CaptureOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    provider: PayPalProvider = Depends(get_provider),
) -> CaptureOrderResponse:
    captured = provider.capture_order(payload.provider_order_id)
    if captured.status != "COMPLETED":
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="Payment not completed")

    existing = db.query(Payment).filter(Payment.provider_payment_id == captured.provider_order_id).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order already captured")

    db.add(
        Payment(
            user_id=current_user.id,
            provider="paypal",
            provider_payment_id=captured.provider_order_id,
            amount_cents=captured.amount_cents,
            currency=captured.currency,
            status="completed",
        )
    )
    subscription = Subscription(
        user_id=current_user.id,
        plan="single_report",
        status="active",
        credits_remaining=1,
        provider="paypal",
        provider_subscription_id=captured.provider_order_id,
    )
    db.add(subscription)
    db.commit()
    db.refresh(subscription)

    return CaptureOrderResponse(status="completed", credits_remaining=subscription.credits_remaining)
