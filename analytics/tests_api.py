"""Tests for registration, profile, preferences, dataset management, and stats."""
import json
import tempfile

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import ChatMessage, ChatSession, Dataset, UsageEvent

User = get_user_model()

MEDIA = tempfile.mkdtemp()
CSV_BYTES = b"region,revenue,units\nNorth,120,4\nSouth,80,2\nEast,60,3\n"


@override_settings(MEDIA_ROOT=MEDIA)
class RegistrationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def _register(self, **overrides):
        payload = {
            'username': 'newuser',
            'email': 'new@example.com',
            'password': 'Str0ngPass!234',
        }
        payload.update(overrides)
        return self.client.post(
            '/api/auth/register/', json.dumps(payload), content_type='application/json'
        )

    def test_registration_returns_tokens_and_profile(self):
        response = self._register()
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertIn('access', body)
        self.assertIn('refresh', body)
        self.assertEqual(body['user']['username'], 'newuser')
        self.assertEqual(body['user']['tier'], 'free')

    def test_registration_creates_a_free_tier_record(self):
        self._register()
        user = User.objects.get(username='newuser')
        self.assertEqual(user.tier.tier, 'free')

    def test_duplicate_username_is_rejected(self):
        self._register()
        response = self._register(email='other@example.com')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'validation_error')

    def test_duplicate_email_is_rejected(self):
        self._register()
        response = self._register(username='another')
        self.assertEqual(response.status_code, 400)
        self.assertIn('email', response.json()['fields'])

    def test_weak_password_is_rejected(self):
        response = self._register(password='123')
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.json()['fields'])

    def test_invalid_email_is_rejected(self):
        response = self._register(email='not-an-email')
        self.assertEqual(response.status_code, 400)

    def test_registration_is_audited(self):
        self._register()
        user = User.objects.get(username='newuser')
        self.assertTrue(UsageEvent.objects.filter(user=user, kind='auth.register').exists())

    def test_username_availability(self):
        self._register()
        taken = self.client.get('/api/auth/username-available/?username=newuser').json()
        free = self.client.get('/api/auth/username-available/?username=nobody').json()
        self.assertFalse(taken['available'])
        self.assertTrue(free['available'])


@override_settings(MEDIA_ROOT=MEDIA)
class ProfileTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(
            username='alice', email='alice@example.com', password='pw'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_me_returns_profile(self):
        body = self.client.get('/api/auth/me/').json()
        self.assertEqual(body['user']['username'], 'alice')
        self.assertEqual(body['user']['display_name'], 'alice')

    def test_display_name_uses_full_name_when_present(self):
        self.client.patch('/api/auth/me/', {'first_name': 'Alice', 'last_name': 'Ray'}, format='json')
        body = self.client.get('/api/auth/me/').json()
        self.assertEqual(body['user']['display_name'], 'Alice Ray')

    def test_email_collision_is_rejected(self):
        User.objects.create_user(username='bob', email='bob@example.com', password='pw')
        response = self.client.patch('/api/auth/me/', {'email': 'bob@example.com'}, format='json')
        self.assertEqual(response.status_code, 409)

    def test_preferences_round_trip(self):
        self.client.put(
            '/api/preferences/', {'theme': 'dark', 'chart_palette': 'ocean'}, format='json'
        )
        body = self.client.get('/api/preferences/').json()
        self.assertEqual(body['preferences']['theme'], 'dark')

        # A partial update merges rather than replacing.
        self.client.put('/api/preferences/', {'theme': 'light'}, format='json')
        body = self.client.get('/api/preferences/').json()
        self.assertEqual(body['preferences']['chart_palette'], 'ocean')
        self.assertEqual(body['preferences']['theme'], 'light')

    def test_password_change_requires_current_password(self):
        response = self.client.post(
            '/api/auth/password/',
            {'current_password': 'wrong', 'new_password': 'An0ther!Pass9'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_password_change_succeeds(self):
        response = self.client.post(
            '/api/auth/password/',
            {'current_password': 'pw', 'new_password': 'An0ther!Pass9'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('An0ther!Pass9'))


@override_settings(MEDIA_ROOT=MEDIA)
class DatasetManagementTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='alice', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _upload(self, name='sales.csv', content=CSV_BYTES):
        return self.client.post(
            '/api/datasets/',
            {'file': SimpleUploadedFile(name, content)},
            format='multipart',
        )

    def test_upload_profiles_the_file(self):
        response = self._upload()
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body['row_count'], 3)
        self.assertEqual(body['column_count'], 3)

        dataset = Dataset.objects.get(pk=body['id'])
        self.assertEqual(len(dataset.column_schema), 3)
        names = {col['name'] for col in dataset.column_schema}
        self.assertEqual(names, {'region', 'revenue', 'units'})

    def test_upload_rejects_empty_file(self):
        response = self._upload(content=b'')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'empty_file')

    def test_upload_rejects_unreadable_file(self):
        # A .xlsx that is not a real ZIP archive cannot be opened by openpyxl.
        response = self._upload(name='broken.xlsx', content=b'\x00\x01\x02 not a workbook')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'unreadable_file')
        self.assertFalse(Dataset.objects.exists())

    def test_rename_and_star(self):
        dataset_id = self._upload().json()['id']
        response = self.client.patch(
            f'/api/datasets/{dataset_id}/', {'name': 'Q3 Sales', 'is_starred': True}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['dataset']['name'], 'Q3 Sales')
        self.assertTrue(response.json()['dataset']['is_starred'])

    def test_preview_returns_head_rows(self):
        dataset_id = self._upload().json()['id']
        body = self.client.get(f'/api/datasets/{dataset_id}/preview/?rows=2').json()
        self.assertEqual(body['preview']['shown'], 2)
        self.assertEqual(body['preview']['total'], 3)
        self.assertEqual(body['preview']['columns'], ['region', 'revenue', 'units'])

    def test_delete_removes_row_and_file(self):
        dataset_id = self._upload().json()['id']
        dataset = Dataset.objects.get(pk=dataset_id)
        storage, path = dataset.file.storage, dataset.file.name
        self.assertTrue(storage.exists(path))

        response = self.client.delete(f'/api/datasets/{dataset_id}/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Dataset.objects.filter(pk=dataset_id).exists())
        self.assertFalse(storage.exists(path))

    def test_cannot_touch_another_users_dataset(self):
        other = User.objects.create_user(username='bob', password='pw')
        dataset = Dataset.objects.create(
            user=other, name='x.csv', file=SimpleUploadedFile('x.csv', CSV_BYTES)
        )
        self.assertEqual(self.client.get(f'/api/datasets/{dataset.id}/').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/datasets/{dataset.id}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/datasets/{dataset.id}/preview/').status_code, 404)


@override_settings(MEDIA_ROOT=MEDIA)
class StatsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='alice', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_stats_start_at_zero(self):
        body = self.client.get('/api/stats/').json()
        self.assertEqual(body['datasets'], 0)
        self.assertEqual(body['sessions'], 0)
        self.assertEqual(body['questions'], 0)

    def test_stats_are_scoped_to_owner(self):
        other = User.objects.create_user(username='bob', password='pw')
        foreign_dataset = Dataset.objects.create(
            user=other, name='x.csv', file=SimpleUploadedFile('x.csv', CSV_BYTES)
        )
        ChatSession.objects.create(user=other, dataset=foreign_dataset)

        body = self.client.get('/api/stats/').json()
        self.assertEqual(body['datasets'], 0)
        self.assertEqual(body['sessions'], 0)

    def test_stats_count_conversation_activity(self):
        dataset = Dataset.objects.create(
            user=self.user, name='sales.csv', file=SimpleUploadedFile('sales.csv', CSV_BYTES),
            row_count=3,
        )
        session = ChatSession.objects.create(user=self.user, dataset=dataset, title='Revenue')
        ChatMessage.objects.create(session=session, role='user', content='total revenue?')
        ChatMessage.objects.create(
            session=session, role='assistant', content='260',
            chart={'chart_type': 'bar', 'chart_data': [{'a': 1}]},
        )

        body = self.client.get('/api/stats/').json()
        self.assertEqual(body['datasets'], 1)
        self.assertEqual(body['sessions'], 1)
        self.assertEqual(body['questions'], 1)
        self.assertEqual(body['answers'], 1)
        self.assertEqual(body['charts'], 1)
        self.assertEqual(len(body['recent_sessions']), 1)
        self.assertEqual(body['recent_sessions'][0]['title'], 'Revenue')
