import logging
import os

from celery.result import AsyncResult
from django.conf import settings
from django.core.cache import cache
from django.db.models import Count, Sum
from django.http import JsonResponse
from django.utils import timezone
from django_ratelimit.core import is_ratelimited
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .analysis import (
    FileRejected,
    AnalysisError,
    load_dataframe,
    profile_dataframe,
    validate_upload,
)
from .models import ChatMessage, ChatSession, Dataset, UsageEvent
from .tasks import run_dataset_analysis
from .tiers import rate_limit_for

logger = logging.getLogger('analytics.views')

TASK_OWNER_CACHE_PREFIX = 'analysis:owner:'
TASK_OWNER_TTL_SECONDS = 3600
AI_QUERY_RATELIMIT_GROUP = 'ai-query'
RATE_LIMIT_WINDOW_SECONDS = 60


def _error(message, status=400, code='error', **extra):
    return JsonResponse({'error': message, 'code': code, **extra}, status=status)


def _not_found(what='Dataset'):
    """A missing row and a foreign row are deliberately indistinguishable."""
    return _error(f'{what} not found.', status=404, code='not_found')


def _dataset_payload(dataset, session_count=None):
    return {
        'id': dataset.id,
        'name': dataset.display_name,
        'uploaded_at': dataset.uploaded_at.isoformat(),
        'row_count': dataset.row_count,
        'column_count': dataset.column_count,
        'size_bytes': dataset.size_bytes,
        'is_starred': dataset.is_starred,
        'truncated': dataset.truncated,
        'last_analyzed_at': dataset.last_analyzed_at.isoformat() if dataset.last_analyzed_at else None,
        'session_count': session_count,
    }


def _message_payload(message):
    return {
        'id': message.id,
        'role': message.role,
        'content': message.content,
        'chart': message.chart,
        'error': message.error or None,
        'method': message.method or None,
        'code': message.code or None,
        'elapsed_ms': message.elapsed_ms,
        'created_at': message.created_at.isoformat(),
    }


def _session_payload(session, include_messages=False, dataset=None):
    payload = {
        'id': session.id,
        'title': session.title or 'New conversation',
        'dataset_id': session.dataset_id,
        'dataset_name': dataset.display_name if dataset else None,
        'is_pinned': session.is_pinned,
        'created_at': session.created_at.isoformat(),
        'updated_at': session.updated_at.isoformat(),
    }
    if include_messages:
        payload['messages'] = [_message_payload(m) for m in session.messages.all()]
    return payload


# --- Datasets ---------------------------------------------------------------


class DatasetListView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        datasets = (
            Dataset.objects.owned_by(request.user)
            .annotate(session_count=Count('sessions'))
            .order_by('-is_starred', '-uploaded_at')
        )
        return JsonResponse({
            'datasets': [_dataset_payload(d, d.session_count) for d in datasets]
        })

    def post(self, request):
        file_obj = request.FILES.get('file')
        try:
            validate_upload(file_obj)
        except FileRejected as exc:
            logger.warning('dataset.rejected user=%s code=%s', request.user.id, exc.code)
            return _error(str(exc), status=400, code=exc.code)

        # Parse before persisting so a malformed file never leaves a broken row behind.
        try:
            df = load_dataframe(_stream_path(file_obj))
            profile = profile_dataframe(df)
        except FileRejected as exc:
            return _error(str(exc), status=400, code=exc.code)
        except AnalysisError as exc:
            return _error(str(exc), status=400, code=exc.code)
        except Exception:
            logger.exception('dataset.unreadable user=%s file=%s', request.user.id, file_obj.name)
            return _error(
                'That file could not be read as a spreadsheet. Check that it is a valid '
                'CSV or Excel file.',
                status=400,
                code='unreadable_file',
            )

        file_obj.seek(0)
        dataset = Dataset.objects.create(
            user=request.user,
            name=os.path.basename(file_obj.name),
            file=file_obj,
            row_count=profile['row_count'],
            column_count=profile['column_count'],
            size_bytes=getattr(file_obj, 'size', 0) or 0,
            column_schema=profile['columns'],
            truncated=profile['truncated'],
        )

        UsageEvent.record(
            request.user, 'dataset.upload',
            dataset_id=dataset.id, rows=profile['row_count'], columns=profile['column_count'],
        )
        logger.info(
            'dataset.uploaded dataset=%s user=%s rows=%d cols=%d',
            dataset.id, request.user.id, profile['row_count'], profile['column_count'],
        )
        return JsonResponse(_dataset_payload(dataset), status=201)


def _stream_path(file_obj):
    """Persist an upload to a scratch location so pandas can stream it.

    ``UploadedFile`` is already a temp file on disk for anything above the memory
    threshold, and Django exposes its path. For small in-memory uploads we write a
    temporary copy first.
    """
    path = getattr(file_obj, 'temporary_file_path', None)
    if path:
        return path

    import tempfile

    suffix = os.path.splitext(file_obj.name)[1].lower()
    handle, temp_path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(handle, 'wb') as target:
        for chunk in file_obj.chunks():
            target.write(chunk)
    file_obj.seek(0)
    return temp_path


class DatasetDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def get(self, request, pk):
        dataset = Dataset.objects.owned_by(request.user).filter(pk=pk).first()
        if dataset is None:
            return _not_found()
        return JsonResponse({'dataset': _dataset_payload(dataset)})

    def patch(self, request, pk):
        dataset = Dataset.objects.owned_by(request.user).filter(pk=pk).first()
        if dataset is None:
            return _not_found()

        data = request.data or {}
        fields = []
        if 'name' in data:
            name = str(data.get('name') or '').strip()[:255]
            if not name:
                return _error('A dataset needs a name.', code='validation_error')
            dataset.name = name
            fields.append('name')
        if 'is_starred' in data:
            dataset.is_starred = bool(data.get('is_starred'))
            fields.append('is_starred')

        if fields:
            dataset.save(update_fields=fields)
        return JsonResponse({'dataset': _dataset_payload(dataset)})

    def delete(self, request, pk):
        dataset = Dataset.objects.owned_by(request.user).filter(pk=pk).first()
        if dataset is None:
            return _not_found()

        storage, path = dataset.file.storage, dataset.file.name
        dataset_id = dataset.id
        dataset.delete()
        # Delete the bytes only after the row is gone, so a storage error cannot
        # leave a database row pointing at a missing file.
        try:
            if path:
                storage.delete(path)
        except Exception:
            logger.warning('dataset.file_delete_failed dataset=%s', dataset_id, exc_info=True)

        UsageEvent.record(request.user, 'dataset.delete', dataset_id=dataset_id)
        logger.info('dataset.deleted dataset=%s user=%s', dataset_id, request.user.id)
        return JsonResponse({'ok': True})


class DatasetPreviewView(APIView):
    """Head of the file plus its column profile, for the data preview panel."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        dataset = Dataset.objects.owned_by(request.user).filter(pk=pk).first()
        if dataset is None:
            return _not_found()

        try:
            df = load_dataframe(dataset.file.path)
        except Exception:
            logger.exception('dataset.preview_failed dataset=%s', dataset.id)
            return _error('This file could not be opened.', status=500, code='unreadable_file')

        limit = max(1, min(int(request.query_params.get('rows', 25) or 25), 100))
        head = df.head(limit)
        for column in head.columns:
            try:
                import pandas as pd

                if pd.api.types.is_datetime64_any_dtype(head[column]):
                    head[column] = head[column].astype(str)
            except Exception:
                pass

        rows = [
            {
                key: (None if _is_na(value) else _scalar(value))
                for key, value in row.items()
            }
            for row in head.to_dict(orient='records')
        ]

        return JsonResponse({
            'dataset': _dataset_payload(dataset),
            'columns': dataset.column_schema,
            'preview': {
                'columns': [str(c) for c in head.columns],
                'rows': rows,
                'shown': len(rows),
                'total': dataset.row_count,
            },
        })


def _is_na(value):
    try:
        import pandas as pd

        return bool(pd.isna(value))
    except (TypeError, ValueError):
        return False


def _scalar(value):
    if hasattr(value, 'item'):
        try:
            return value.item()
        except Exception:
            pass
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)[:200]


# --- Chat -------------------------------------------------------------------


class SessionChatView(APIView):
    """Queue an AI analysis against a conversation, enforcing ownership and limits."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request, pk, *args, **kwargs):
        question = (request.data.get('question') or '').strip()
        if not question:
            return _error("Missing 'question' field.", code='validation_error')
        if len(question) > 4_000:
            return _error('That question is too long. Keep it under 4,000 characters.', code='validation_error')

        session = (
            ChatSession.objects.owned_by(request.user)
            .select_related('dataset')
            .filter(pk=pk)
            .first()
        )
        if session is None:
            return _not_found('Conversation')

        rate = rate_limit_for(request.user)
        if is_ratelimited(
            request=request,
            group=AI_QUERY_RATELIMIT_GROUP,
            key='user',
            rate=rate,
            method='POST',
            increment=True,
        ):
            logger.warning('ai_query.rate_limited user=%s rate=%s', request.user.id, rate)
            response = _error(
                f'Too many AI queries. Your plan allows {rate}.',
                status=429,
                code='rate_limited',
            )
            response['Retry-After'] = str(RATE_LIMIT_WINDOW_SECONDS)
            return response

        user_message = ChatMessage.objects.create(
            session=session, role=ChatMessage.USER, content=question
        )

        # The first question becomes the conversation title, so the sidebar reads
        # like a list of questions rather than "Conversation 1..n".
        if not session.title:
            session.title = question[:120]
            session.save(update_fields=['title'])
        session.touch()

        history = list(
            session.messages.exclude(pk=user_message.pk)
            .exclude(content='')
            .order_by('-created_at')[:12]
        )
        history_payload = [
            {'role': m.role, 'content': m.content} for m in reversed(history)
        ]

        task = run_dataset_analysis.delay(session.id, question, request.user.id, history_payload)
        cache.set(
            f'{TASK_OWNER_CACHE_PREFIX}{task.id}',
            request.user.id,
            timeout=TASK_OWNER_TTL_SECONDS,
        )

        UsageEvent.record(request.user, 'analysis.enqueued', session_id=session.id)
        logger.info(
            'analysis.enqueued task=%s session=%s dataset=%s user=%s',
            task.id, session.id, session.dataset_id, request.user.id,
        )
        return JsonResponse({
            'task_id': task.id,
            'status': 'PENDING',
            'user_message': _message_payload(user_message),
            'session': _session_payload(session),
        }, status=202)


class TaskStatusView(APIView):
    """Poll the status of a dispatched analysis task, enforcing task ownership."""

    permission_classes = [IsAuthenticated]

    def get(self, request, task_id, *args, **kwargs):
        cached_owner = cache.get(f'{TASK_OWNER_CACHE_PREFIX}{task_id}')
        if cached_owner is not None and cached_owner != request.user.id:
            logger.warning('task.access_denied user=%s task=%s', request.user.id, task_id)
            return _not_found('Task')

        result = AsyncResult(task_id)
        state = result.state

        info = {}
        if state == 'PROGRESS':
            info = result.info if isinstance(result.info, dict) else {}
        elif state == 'SUCCESS':
            info = result.result if isinstance(result.result, dict) else {}

        meta_owner = info.get('user_id')
        if meta_owner is not None and meta_owner != request.user.id:
            logger.warning('task.access_denied user=%s task=%s', request.user.id, task_id)
            return _not_found('Task')

        payload = {'task_id': task_id, 'status': state}

        if state == 'PROGRESS':
            payload.update({
                'stage': info.get('stage'),
                'tokens': info.get('tokens', []),
                'chart': info.get('chart'),
            })
        elif state == 'SUCCESS':
            payload['ok'] = bool(info.get('ok'))
            if info.get('ok'):
                payload.update({
                    'stage': 'done',
                    'answer': info.get('answer', ''),
                    'chart': info.get('chart'),
                    'table': info.get('table'),
                    'elapsed': info.get('elapsed'),
                    'message_id': info.get('message_id'),
                    'method': info.get('method'),
                    'code': info.get('code'),
                    'truncated': info.get('truncated', False),
                })
            else:
                payload['error'] = info.get('error', 'The analysis could not be completed.')
                payload['code'] = info.get('code')
        elif state == 'FAILURE':
            logger.error('analysis.status_failure task=%s info=%r', task_id, result.info)
            payload['error'] = 'The analysis failed while running. Please check the server logs.'
            if settings.DEBUG:
                payload['detail'] = str(result.info)
        elif state == 'REVOKED':
            payload['error'] = 'The analysis was stopped.'

        return JsonResponse(payload)


# --- Dashboard --------------------------------------------------------------


class StatsView(APIView):
    """Aggregate counters for the workspace overview."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        datasets = Dataset.objects.owned_by(request.user)
        sessions = ChatSession.objects.owned_by(request.user)
        messages = ChatMessage.objects.filter(session__user=request.user)

        total_bytes = datasets.aggregate(total=Sum('size_bytes'))['total'] or 0
        answers = messages.filter(role=ChatMessage.ASSISTANT).exclude(content='')
        recent = (
            sessions.select_related('dataset')
            .annotate(message_count=Count('messages'))
            .order_by('-updated_at')[:5]
        )

        return JsonResponse({
            'datasets': datasets.count(),
            'sessions': sessions.count(),
            'questions': messages.filter(role=ChatMessage.USER).count(),
            'answers': answers.count(),
            'charts': answers.exclude(chart__isnull=True).exclude(chart={}).count(),
            'rows_under_analysis': datasets.aggregate(total=Sum('row_count'))['total'] or 0,
            'storage_bytes': total_bytes,
            'recent_sessions': [
                {
                    'id': s.id,
                    'title': s.title or 'New conversation',
                    'dataset_id': s.dataset_id,
                    'dataset_name': s.dataset.display_name,
                    'message_count': s.message_count,
                    'updated_at': s.updated_at.isoformat(),
                }
                for s in recent
            ],
        })


def health(request):
    """Unauthenticated liveness probe for Compose and load balancers."""
    return JsonResponse({
        'status': 'ok',
        'time': timezone.now().isoformat(),
        'model': settings.OLLAMA_MODEL,
    })
