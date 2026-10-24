import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

User = get_user_model()

MEDIA = tempfile.mkdtemp()
UPLOAD_URL = '/api/datasets/'


@override_settings(MEDIA_ROOT=MEDIA)
class DatasetUploadTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='uploader', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_accepts_csv(self):
        upload = SimpleUploadedFile('sales.csv', b'region,revenue\nNorth,120\n')
        response = self.client.post(UPLOAD_URL, {'file': upload}, format='multipart')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['name'], 'sales.csv')

    def test_accepts_uppercase_extension(self):
        upload = SimpleUploadedFile('SALES.CSV', b'region,revenue\nNorth,120\n')
        response = self.client.post(UPLOAD_URL, {'file': upload}, format='multipart')
        self.assertEqual(response.status_code, 201)

    def test_rejects_unsupported_type(self):
        upload = SimpleUploadedFile('notes.txt', b'just text')
        response = self.client.post(UPLOAD_URL, {'file': upload}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertIn('Unsupported file type', response.json()['error'])
