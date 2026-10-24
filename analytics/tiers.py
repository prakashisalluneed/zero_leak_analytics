from .models import UserTier

DEFAULT_TIER = UserTier.FREE

# AI-query rate limits per tier, in django-ratelimit rate syntax.
TIER_RATE_LIMITS = {
    UserTier.FREE: '5/m',
    UserTier.PRO: '50/m',
}


def get_tier_record(user):
    """Return the user's UserTier row, creating a Free record on first use.

    Callers that need the whole record (preferences, Stripe ids) use this; callers
    that only need the plan name use :func:`get_user_tier`.
    """
    record, _ = UserTier.objects.get_or_create(user=user)
    return record


def get_user_tier(user):
    """Return the user's tier string, creating a Free record on first use."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return DEFAULT_TIER
    return get_tier_record(user).tier


def rate_limit_for_tier(tier):
    return TIER_RATE_LIMITS.get(tier, TIER_RATE_LIMITS[DEFAULT_TIER])


def rate_limit_for(user):
    return rate_limit_for_tier(get_user_tier(user))


def set_user_tier(user, tier, customer_id=None, subscription_id=None):
    """Create or update a user's tier. Used by the (mock) Stripe webhook."""
    record, _ = UserTier.objects.get_or_create(user=user)
    record.tier = tier
    if customer_id is not None:
        record.stripe_customer_id = customer_id
    if subscription_id is not None:
        record.stripe_subscription_id = subscription_id
    record.save(update_fields=['tier', 'stripe_customer_id', 'stripe_subscription_id', 'updated_at'])
    return record
