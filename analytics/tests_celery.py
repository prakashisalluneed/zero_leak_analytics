import tempfile
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from .models import ChatMessage, ChatSession, Dataset

User = get_user_model()

MEDIA = tempfile.mkdtemp()
CSV_BYTES = b"region,revenue\nNorth,120\nSouth,80\nEast,60\n"


class FakeLLM:
    """Deterministic stand-in for OllamaLLM; no model server required."""

    def invoke(self, prompt):
        return (
            "result = {'chart_type': 'bar', "
            "'chart_data': df.groupby('region')['revenue'].sum().reset_index()}"
        )

    def stream(self, prompt):
        for token in ['Revenue ', 'is ', 'highest ', 'in ', 'the ', 'North ', 'region.']:
            yield token


class ScalarLLM:
    """Answers with a plain scalar so the table/formatting path is exercised."""

    def invoke(self, prompt):
        return "result = int(df['revenue'].sum())"

    def stream(self, prompt):
        for token in ['Total ', 'revenue ', 'is ', '260.']:
            yield token


@override_settings(MEDIA_ROOT=MEDIA)
class CeleryAnalysisTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='tester', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _dataset(self, name='sales.csv', content=CSV_BYTES):
        upload = SimpleUploadedFile(name, content)
        dataset = Dataset.objects.create(user=self.user, name=name, file=upload)
        ChatSession.objects.create(user=self.user, dataset=dataset, title='Test chat')
        return dataset

    def _session(self, dataset):
        return ChatSession.objects.filter(dataset=dataset).first()

    def _enqueue(self, dataset, question='chart revenue by region'):
        return self.client.post(
            f'/api/sessions/{self._session(dataset).id}/chat/',
            {'question': question},
            format='json',
        )

    @mock.patch('analytics.tasks.get_llm', return_value=FakeLLM())
    def test_enqueue_returns_task_id_and_poll_completes(self, _llm):
        dataset = self._dataset()

        queued = self._enqueue(dataset)
        self.assertEqual(queued.status_code, 202)
        body = queued.json()
        task_id = body['task_id']
        self.assertTrue(task_id)
        self.assertEqual(body['user_message']['role'], 'user')

        status = self.client.get(f'/api/tasks/{task_id}/')
        self.assertEqual(status.status_code, 200)
        body = status.json()

        self.assertEqual(body['status'], 'SUCCESS')
        self.assertTrue(body['ok'])
        # Chart results get a derived caption rather than a second model call.
        self.assertIn('bar chart', body['answer'])
        self.assertEqual(body['chart']['chart_type'], 'bar')
        self.assertEqual(len(body['chart']['chart_data']), 3)
        self.assertEqual(
            {row['region'] for row in body['chart']['chart_data']},
            {'North', 'South', 'East'},
        )

    @mock.patch('analytics.tasks.get_llm', return_value=ScalarLLM())
    def test_scalar_answer_is_formatted_and_persisted(self, _llm):
        dataset = self._dataset()
        task_id = self._enqueue(dataset).json()['task_id']

        body = self.client.get(f'/api/tasks/{task_id}/').json()
        self.assertTrue(body['ok'])
        self.assertIn('260', body['answer'])
        self.assertIsNone(body['chart'])

        # The assistant turn is persisted so a reload keeps the conversation.
        session = self._session(dataset)
        messages = list(session.messages.all())
        self.assertEqual([m.role for m in messages], ['user', 'assistant'])
        self.assertIn('260', messages[1].content)
        self.assertIsNotNone(messages[1].elapsed_ms)
        self.assertEqual(messages[1].pk, body['message_id'])

    @mock.patch('analytics.tasks.get_llm', return_value=FakeLLM())
    def test_session_title_comes_from_the_first_question(self, _llm):
        dataset = Dataset.objects.create(
            user=self.user, name='fresh.csv', file=SimpleUploadedFile('fresh.csv', CSV_BYTES)
        )
        session = ChatSession.objects.create(user=self.user, dataset=dataset)
        self.client.post(
            f'/api/sessions/{session.id}/chat/',
            {'question': 'Which region earns most?'},
            format='json',
        )
        session.refresh_from_db()
        self.assertEqual(session.title, 'Which region earns most?')

    def test_enqueue_missing_session_returns_404(self):
        response = self.client.post('/api/sessions/999999/chat/', {'question': 'hi'}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_enqueue_other_users_session_returns_404(self):
        owner = User.objects.create_user(username='owner', password='pw')
        dataset = Dataset.objects.create(
            user=owner, name='owned.csv', file=SimpleUploadedFile('owned.csv', CSV_BYTES)
        )
        session = ChatSession.objects.create(user=owner, dataset=dataset)

        response = self.client.post(
            f'/api/sessions/{session.id}/chat/', {'question': 'rows?'}, format='json'
        )
        self.assertEqual(response.status_code, 404)

    @mock.patch('analytics.tasks.get_llm', return_value=FakeLLM())
    def test_status_hidden_from_another_user(self, _llm):
        dataset = self._dataset()
        task_id = self._enqueue(dataset).json()['task_id']

        other = User.objects.create_user(username='intruder', password='pw')
        other_client = APIClient()
        other_client.force_authenticate(other)

        response = other_client.get(f'/api/tasks/{task_id}/')
        self.assertEqual(response.status_code, 404)

    def test_unsupported_file_reports_structured_error(self):
        dataset = self._dataset(name='notes.txt', content=b'just text')
        task_id = self._enqueue(dataset).json()['task_id']

        body = self.client.get(f'/api/tasks/{task_id}/').json()
        self.assertEqual(body['status'], 'SUCCESS')
        self.assertFalse(body['ok'])
        self.assertEqual(body['code'], 'unsupported_type')

        # A failed run is still recorded so the transcript shows what happened.
        failure = ChatMessage.objects.filter(session=self._session(dataset), role='assistant').last()
        self.assertTrue(failure.error)


@override_settings(MEDIA_ROOT=MEDIA)
class SessionApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='alice', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.dataset = Dataset.objects.create(
            user=self.user, name='sales.csv', file=SimpleUploadedFile('sales.csv', CSV_BYTES)
        )

    def test_create_and_list_sessions(self):
        created = self.client.post(
            '/api/sessions/', {'dataset_id': self.dataset.id}, format='json'
        )
        self.assertEqual(created.status_code, 201)
        session_id = created.json()['session']['id']

        listed = self.client.get('/api/sessions/').json()['sessions']
        self.assertEqual([s['id'] for s in listed], [session_id])

    def test_cannot_create_session_on_foreign_dataset(self):
        other = User.objects.create_user(username='bob', password='pw')
        foreign = Dataset.objects.create(
            user=other, name='x.csv', file=SimpleUploadedFile('x.csv', CSV_BYTES)
        )
        response = self.client.post('/api/sessions/', {'dataset_id': foreign.id}, format='json')
        self.assertEqual(response.status_code, 404)

    def test_rename_and_pin(self):
        session = ChatSession.objects.create(user=self.user, dataset=self.dataset)
        response = self.client.patch(
            f'/api/sessions/{session.id}/', {'title': 'Q3 revenue', 'is_pinned': True}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.title, 'Q3 revenue')
        self.assertTrue(session.is_pinned)

    def test_delete_session(self):
        session = ChatSession.objects.create(user=self.user, dataset=self.dataset)
        response = self.client.delete(f'/api/sessions/{session.id}/')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ChatSession.objects.filter(pk=session.pk).exists())

    def test_cannot_read_another_users_session(self):
        other = User.objects.create_user(username='bob', password='pw')
        foreign_dataset = Dataset.objects.create(
            user=other, name='x.csv', file=SimpleUploadedFile('x.csv', CSV_BYTES)
        )
        foreign = ChatSession.objects.create(user=other, dataset=foreign_dataset)
        self.assertEqual(self.client.get(f'/api/sessions/{foreign.id}/').status_code, 404)

    def test_session_list_is_filtered_by_dataset(self):
        other_dataset = Dataset.objects.create(
            user=self.user, name='other.csv', file=SimpleUploadedFile('other.csv', CSV_BYTES)
        )
        mine = ChatSession.objects.create(user=self.user, dataset=self.dataset)
        ChatSession.objects.create(user=self.user, dataset=other_dataset)

        listed = self.client.get(f'/api/sessions/?dataset={self.dataset.id}').json()['sessions']
        self.assertEqual([s['id'] for s in listed], [mine.id])
