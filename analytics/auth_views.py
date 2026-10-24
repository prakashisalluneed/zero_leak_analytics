"""Authentication endpoints: registration, profile, and password management."""
import logging

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import UsageEvent, UserTier
from .tiers import get_tier_record, get_user_tier

logger = logging.getLogger('analytics.auth')

User = get_user_model()

MAX_NAME_LENGTH = 60


def profile_payload(user):
    """The canonical shape the SPA uses for the signed-in user."""
    tier = get_user_tier(user)
    display = user.get_full_name().strip() or user.username
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'display_name': display,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'tier': tier,
        'date_joined': user.date_joined.isoformat(),
    }


def _normalise_name(value, field):
    value = (value or '').strip()
    if len(value) > MAX_NAME_LENGTH:
        raise ValidationError(f'{field} must be {MAX_NAME_LENGTH} characters or fewer.')
    return value


@csrf_exempt
@require_POST
def register(request):
    """Create an account and return a usable token pair.

    Kept deliberately small: username, email, password, optional name. Every new
    account starts on the free tier; no email verification is required because the
    product is deployed on a private host.
    """
    import json

    try:
        payload = json.loads(request.body or b'{}')
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON payload.', 'code': 'bad_request'}, status=400)

    username = (payload.get('username') or '').strip()
    email = (payload.get('email') or '').strip().lower()
    password = payload.get('password') or ''
    first_name = (payload.get('first_name') or '').strip()
    last_name = (payload.get('last_name') or '').strip()

    errors = {}
    if not username:
        errors['username'] = 'Choose a username.'
    elif len(username) > 150:
        errors['username'] = 'Username must be 150 characters or fewer.'
    elif User.objects.filter(username__iexact=username).exists():
        errors['username'] = 'That username is taken.'

    if not email:
        errors['email'] = 'Enter your email address.'
    elif '@' not in email or '.' not in email.split('@')[-1]:
        errors['email'] = 'Enter a valid email address.'
    elif User.objects.filter(email__iexact=email).exists():
        errors['email'] = 'An account with that email already exists.'

    if not password:
        errors['password'] = 'Choose a password.'
    else:
        try:
            validate_password(password)
        except ValidationError as exc:
            errors['password'] = ' '.join(exc.messages)

    try:
        first_name = _normalise_name(first_name, 'First name')
        last_name = _normalise_name(last_name, 'Last name')
    except ValidationError as exc:
        errors['name'] = ' '.join(exc.messages)

    if errors:
        first = next(iter(errors.values()))
        return JsonResponse({'error': first, 'code': 'validation_error', 'fields': errors}, status=400)

    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name,
            )
            UserTier.objects.get_or_create(user=user)
    except IntegrityError:
        return JsonResponse(
            {'error': 'That username or email is already registered.', 'code': 'conflict'},
            status=409,
        )

    UsageEvent.record(user, 'auth.register')
    logger.info('auth.registered user=%s', user.id)

    refresh = RefreshToken.for_user(user)
    return JsonResponse(
        {'access': str(refresh.access_token), 'refresh': str(refresh), 'user': profile_payload(user)},
        status=201,
    )


class MeView(APIView):
    """Read and update the signed-in user's profile and preferences."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return JsonResponse({'user': profile_payload(request.user)})

    def patch(self, request):
        user = request.user
        data = request.data or {}
        changed = []

        if 'first_name' in data or 'last_name' in data:
            try:
                user.first_name = _normalise_name(
                    data.get('first_name', user.first_name), 'First name'
                )
                user.last_name = _normalise_name(
                    data.get('last_name', user.last_name), 'Last name'
                )
            except ValidationError as exc:
                return JsonResponse(
                    {'error': ' '.join(exc.messages), 'code': 'validation_error'}, status=400
                )
            changed += ['first_name', 'last_name']

        if 'email' in data:
            email = (data.get('email') or '').strip().lower()
            if not email or '@' not in email:
                return JsonResponse(
                    {'error': 'Enter a valid email address.', 'code': 'validation_error'}, status=400
                )
            if User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
                return JsonResponse(
                    {'error': 'That email is already in use.', 'code': 'conflict'}, status=409
                )
            user.email = email
            changed.append('email')

        if changed:
            user.save(update_fields=changed)
            logger.info('auth.profile_updated user=%s fields=%s', user.pk, changed)

        return JsonResponse({'user': profile_payload(user)})


class PreferencesView(APIView):
    """Persist UI and analysis preferences as JSON on the tier record."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        record = get_tier_record(request.user)
        return JsonResponse({'preferences': record.preferences or {}})

    def put(self, request):
        record = get_tier_record(request.user)
        incoming = request.data or {}
        if not isinstance(incoming, dict):
            return JsonResponse(
                {'error': 'Preferences must be an object.', 'code': 'validation_error'}, status=400
            )

        current = dict(record.preferences or {})
        current.update(incoming)
        record.preferences = current
        record.save(update_fields=['preferences', 'updated_at'])
        return JsonResponse({'preferences': current})


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        current = (request.data or {}).get('current_password') or ''
        new = (request.data or {}).get('new_password') or ''

        if not request.user.check_password(current):
            return JsonResponse(
                {'error': 'Your current password is incorrect.', 'code': 'invalid_password'}, status=400
            )
        if not new:
            return JsonResponse(
                {'error': 'Enter a new password.', 'code': 'validation_error'}, status=400
            )
        try:
            validate_password(new, request.user)
        except ValidationError as exc:
            return JsonResponse(
                {'error': ' '.join(exc.messages), 'code': 'validation_error'}, status=400
            )

        request.user.set_password(new)
        request.user.save(update_fields=['password'])
        UsageEvent.record(request.user, 'auth.password_changed')
        logger.info('auth.password_changed user=%s', request.user.pk)
        return JsonResponse({'ok': True})


class CheckUsernameView(APIView):
    """Cheap availability probe used by the sign-up form for inline feedback."""

    permission_classes = [AllowAny]

    def get(self, request):
        username = (request.query_params.get('username') or '').strip()
        if not username:
            return JsonResponse({'available': False, 'reason': 'Enter a username.'})
        if len(username) > 150:
            return JsonResponse({'available': False, 'reason': 'Too long.'})
        taken = User.objects.filter(username__iexact=username).exists()
        return JsonResponse({
            'available': not taken,
            'reason': 'That username is taken.' if taken else '',
        })
