import hashlib
import hmac
import json
import tempfile
from types import SimpleNamespace
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import ChatSession, Dataset, UserTier
from .tiers import set_user_tier

User = get_user_model()

MEDIA = tempfile.mkdtemp()
CSV_BYTES = b"region,revenue\nNorth,120\nSouth,80\n"
WEBHOOK_URL = '/api/billing/stripe/webhook/'
CHAT_URL = '/api/sessions/{pk}/chat/'
TASK_URL = '/api/tasks/{task_id}/'


def make_dataset(user, name='sales.csv'):
    return Dataset.objects.create(user=user, name=name, file=SimpleUploadedFile(name, CSV_BYTES))


def make_session(user, name='sales.csv'):
    """A conversation owned by ``user``, which is what the chat endpoint takes."""
    dataset = make_dataset(user, name)
    return ChatSession.objects.create(user=user, dataset=dataset)


def sign(body, secret=None):
    secret = secret or settings.STRIPE_WEBHOOK_SECRET
    return hmac.new(secret.encode('utf-8'), body, hashlib.sha256).hexdigest()


@override_settings(MEDIA_ROOT=MEDIA)
class DatasetIdorTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='alice', password='pw')
        self.other = User.objects.create_user(username='bob', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_is_scoped_to_owner(self):
        mine = make_dataset(self.user, 'mine.csv')
        theirs = make_dataset(self.other, 'theirs.csv')
        orphan = Dataset.objects.create(
            user=None, name='orphan.csv', file=SimpleUploadedFile('orphan.csv', CSV_BYTES)
        )

        ids = [d['id'] for d in self.client.get('/api/datasets/').json()['datasets']]
        self.assertIn(mine.id, ids)
        self.assertNotIn(theirs.id, ids)
        self.assertNotIn(orphan.id, ids)

    def test_cannot_enqueue_on_another_users_session(self):
        theirs = make_session(self.other, 'secret.csv')
        response = self.client.post(CHAT_URL.format(pk=theirs.id), {'question': 'rows?'}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_cannot_enqueue_on_ownerless_dataset(self):
        orphan = Dataset.objects.create(
            user=None, name='orphan.csv', file=SimpleUploadedFile('orphan.csv', CSV_BYTES)
        )
        response = self.client.post(CHAT_URL.format(pk=orphan.id), {'question': 'rows?'}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_cannot_poll_another_users_task(self):
        session = make_session(self.user)
        with mock.patch(
            'analytics.views.run_dataset_analysis.delay',
            return_value=SimpleNamespace(id='task-alice'),
        ):
            queued = self.client.post(CHAT_URL.format(pk=session.id), {'question': 'rows?'}, format='json')
        self.assertEqual(queued.status_code, 202)

        bob_client = APIClient()
        bob_client.force_authenticate(self.other)
        polled = bob_client.get(TASK_URL.format(task_id='task-alice'))
        self.assertEqual(polled.status_code, 404)


@override_settings(MEDIA_ROOT=MEDIA)
class AiQueryRateLimitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='alice', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.session = make_session(self.user)
        self.url = CHAT_URL.format(pk=self.session.id)

    def _post(self, question='rows?'):
        with mock.patch(
            'analytics.views.run_dataset_analysis.delay',
            return_value=SimpleNamespace(id='task-x'),
        ):
            return self.client.post(self.url, {'question': question}, format='json')

    def test_free_tier_allows_five_then_blocks(self):
        for index in range(5):
            self.assertEqual(
                self._post(f'q{index}').status_code, 202, f'free request {index + 1} should pass'
            )

        limited = self._post('q6')
        self.assertEqual(limited.status_code, 429)
        self.assertEqual(limited.json()['code'], 'rate_limited')
        self.assertIn('Retry-After', limited)

    def test_pro_tier_is_not_blocked_after_five(self):
        set_user_tier(self.user, UserTier.PRO)
        for index in range(6):
            self.assertEqual(
                self._post(f'q{index}').status_code, 202, f'pro request {index + 1} should pass'
            )


@override_settings(MEDIA_ROOT=MEDIA)
class StripeWebhookTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='alice', password='pw')
        self.client = APIClient()

    def _event(self, event_id, event_type, obj):
        return {'id': event_id, 'type': event_type, 'data': {'object': obj}}

    def _post_event(self, event, secret=None):
        body = json.dumps(event).encode('utf-8')
        return self.client.post(
            WEBHOOK_URL,
            data=body,
            content_type='application/json',
            HTTP_X_STRIPE_SIGNATURE=sign(body, secret),
        )

    def test_checkout_completed_upgrades_to_pro(self):
        event = self._event('evt_up', 'checkout.session.completed', {
            'client_reference_id': str(self.user.id),
            'customer': 'cus_123',
            'subscription': 'sub_123',
        })
        response = self._post_event(event)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['handled'])

        record = UserTier.objects.get(user=self.user)
        self.assertEqual(record.tier, UserTier.PRO)
        self.assertEqual(record.stripe_customer_id, 'cus_123')
        self.assertEqual(record.stripe_subscription_id, 'sub_123')

    def test_invalid_signature_is_rejected(self):
        event = self._event('evt_bad', 'checkout.session.completed', {
            'client_reference_id': str(self.user.id),
        })
        body = json.dumps(event).encode('utf-8')
        response = self.client.post(
            WEBHOOK_URL, data=body, content_type='application/json', HTTP_X_STRIPE_SIGNATURE='deadbeef'
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(UserTier.objects.filter(user=self.user, tier=UserTier.PRO).exists())

    def test_duplicate_event_is_idempotent(self):
        event = self._event('evt_dup', 'checkout.session.completed', {
            'client_reference_id': str(self.user.id),
        })
        self.assertEqual(self._post_event(event).status_code, 200)

        second = self._post_event(event)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json().get('duplicate'))

    def test_subscription_deleted_downgrades_to_free(self):
        set_user_tier(self.user, UserTier.PRO, subscription_id='sub_123')
        event = self._event('evt_del', 'customer.subscription.deleted', {
            'client_reference_id': str(self.user.id),
        })
        self.assertEqual(self._post_event(event).status_code, 200)
        self.assertEqual(UserTier.objects.get(user=self.user).tier, UserTier.FREE)

    def test_get_is_not_allowed(self):
        self.assertEqual(self.client.get(WEBHOOK_URL).status_code, 405)


@override_settings(MEDIA_ROOT=MEDIA)
class BillingMeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='alice', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_defaults_to_free(self):
        body = self.client.get('/api/billing/me/').json()
        self.assertEqual(body['tier'], UserTier.FREE)
        self.assertEqual(body['rate_limit'], '5/m')

    def test_reports_pro_after_upgrade(self):
        set_user_tier(self.user, UserTier.PRO)
        body = self.client.get('/api/billing/me/').json()
        self.assertEqual(body['tier'], UserTier.PRO)
        self.assertEqual(body['rate_limit'], '50/m')
