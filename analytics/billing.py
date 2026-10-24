import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .models import UserTier
from .tiers import TIER_RATE_LIMITS, get_user_tier, set_user_tier

logger = logging.getLogger('analytics.billing')

User = get_user_model()

# Stripe event types that change a plan.
UPGRADE_EVENTS = {
    'checkout.session.completed',
    'invoice.payment_succeeded',
    'customer.subscription.updated',
}
DOWNGRADE_EVENTS = {
    'customer.subscription.deleted',
    'invoice.payment_failed',
}

IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24


def signature_is_valid(request, raw_body):
    """Constant-time comparison of a mock Stripe signature over the raw body."""
    secret = getattr(settings, 'STRIPE_WEBHOOK_SECRET', '')
    if not secret:
        logger.error('stripe.webhook.rejected reason=missing_secret')
        return False
    provided = request.headers.get('X-Stripe-Signature', '')
    expected = hmac.new(secret.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, expected)


def _resolve_user(obj):
    """Map a Stripe object to a local User via client_reference_id / metadata / email."""
    user_id = obj.get('client_reference_id') or (obj.get('metadata') or {}).get('user_id')
    if user_id not in (None, ''):
        try:
            return User.objects.filter(pk=int(user_id)).first()
        except (TypeError, ValueError):
            return None

    email = obj.get('customer_email') or (obj.get('customer_details') or {}).get('email')
    if email:
        return User.objects.filter(email__iexact=email).first()
    return None


def apply_stripe_event(event):
    """Apply a mock Stripe event. Returns (handled, detail)."""
    event_type = event.get('type')
    obj = (event.get('data') or {}).get('object') or {}

    if event_type in UPGRADE_EVENTS:
        user = _resolve_user(obj)
        if user is None:
            return False, 'no user could be resolved from the event payload'
        set_user_tier(
            user,
            UserTier.PRO,
            customer_id=obj.get('customer'),
            subscription_id=obj.get('subscription'),
        )
        logger.info('billing.upgraded user=%s event=%s', user.id, event_type)
        return True, f'user {user.id} upgraded to pro'

    if event_type in DOWNGRADE_EVENTS:
        user = _resolve_user(obj)
        if user is None:
            return False, 'no user could be resolved from the event payload'
        set_user_tier(user, UserTier.FREE, subscription_id='')
        logger.info('billing.downgraded user=%s event=%s', user.id, event_type)
        return True, f'user {user.id} downgraded to free'

    return False, f'ignored event type {event_type!r}'


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """Mock Stripe webhook: verifies an HMAC signature, then upgrades/downgrades a tier."""
    raw_body = request.body

    if not signature_is_valid(request, raw_body):
        logger.warning(
            'stripe.webhook.invalid_signature ip=%s', request.META.get('REMOTE_ADDR')
        )
        return JsonResponse({'error': 'Invalid signature'}, status=400)

    try:
        event = json.loads(raw_body)
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON payload'}, status=400)

    event_id = event.get('id')
    if event_id and cache.get(f'stripe:event:{event_id}'):
        logger.info('stripe.webhook.duplicate event=%s', event_id)
        return JsonResponse({'received': True, 'duplicate': True}, status=200)

    try:
        handled, detail = apply_stripe_event(event)
    except Exception:
        # Return 500 so a real Stripe would retry the delivery.
        logger.exception('stripe.webhook.processing_failed event=%s', event_id)
        return JsonResponse({'error': 'Failed to process event'}, status=500)

    if event_id:
        cache.set(f'stripe:event:{event_id}', 1, timeout=IDEMPOTENCY_TTL_SECONDS)

    return JsonResponse({'received': True, 'handled': handled, 'detail': detail}, status=200)


class BillingMeView(APIView):
    """Expose the caller's current tier and rate limit so the UI can display them."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        tier = get_user_tier(request.user)
        return JsonResponse({'tier': tier, 'rate_limit': TIER_RATE_LIMITS[tier]})
