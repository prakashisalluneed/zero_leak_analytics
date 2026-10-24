"""Conversation CRUD. Every query is scoped to the requesting user."""
import logging

from django.db.models import Count, Prefetch
from django.http import JsonResponse
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .models import ChatMessage, ChatSession, Dataset, UsageEvent

logger = logging.getLogger('analytics.sessions')


def _not_found():
    return JsonResponse({'error': 'Conversation not found.', 'code': 'not_found'}, status=404)


def _message(message):
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


class SessionListView(APIView):
    """List conversations, optionally filtered to one dataset."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        sessions = ChatSession.objects.owned_by(request.user).select_related('dataset')

        dataset_id = request.query_params.get('dataset')
        if dataset_id:
            sessions = sessions.filter(dataset_id=dataset_id)

        if request.query_params.get('pinned') == '1':
            sessions = sessions.filter(is_pinned=True)

        sessions = sessions.annotate(message_count=Count('messages')).order_by(
            '-is_pinned', '-updated_at'
        )[:100]

        return JsonResponse({
            'sessions': [
                {
                    'id': s.id,
                    'title': s.title or 'New conversation',
                    'dataset_id': s.dataset_id,
                    'dataset_name': s.dataset.display_name,
                    'is_pinned': s.is_pinned,
                    'message_count': s.message_count,
                    'created_at': s.created_at.isoformat(),
                    'updated_at': s.updated_at.isoformat(),
                }
                for s in sessions
            ]
        })

    def post(self, request):
        data = request.data or {}
        dataset = (
            Dataset.objects.owned_by(request.user)
            .filter(pk=data.get('dataset_id'))
            .first()
        )
        if dataset is None:
            return JsonResponse({'error': 'Dataset not found.', 'code': 'not_found'}, status=404)

        session = ChatSession.objects.create(
            user=request.user,
            dataset=dataset,
            title=(data.get('title') or '')[:200],
        )
        UsageEvent.record(request.user, 'session.create', session_id=session.id)
        return JsonResponse({
            'session': {
                'id': session.id,
                'title': session.title or 'New conversation',
                'dataset_id': dataset.id,
                'dataset_name': dataset.display_name,
                'is_pinned': False,
                'messages': [],
                'created_at': session.created_at.isoformat(),
                'updated_at': session.updated_at.isoformat(),
            }
        }, status=201)


class SessionDetailView(APIView):
    """Read, rename, pin, or delete one conversation."""

    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def get(self, request, pk):
        session = (
            ChatSession.objects.owned_by(request.user)
            .select_related('dataset')
            .filter(pk=pk)
            .first()
        )
        if session is None:
            return _not_found()

        messages = session.messages.all()
        return JsonResponse({
            'session': {
                'id': session.id,
                'title': session.title or 'New conversation',
                'dataset_id': session.dataset_id,
                'dataset_name': session.dataset.display_name,
                'is_pinned': session.is_pinned,
                'created_at': session.created_at.isoformat(),
                'updated_at': session.updated_at.isoformat(),
                'messages': [_message(m) for m in messages],
            }
        })

    def patch(self, request, pk):
        session = ChatSession.objects.owned_by(request.user).filter(pk=pk).first()
        if session is None:
            return _not_found()

        data = request.data or {}
        fields = []
        if 'title' in data:
            title = str(data.get('title') or '').strip()[:200]
            if not title:
                return JsonResponse(
                    {'error': 'A conversation needs a title.', 'code': 'validation_error'}, status=400
                )
            session.title = title
            fields.append('title')
        if 'is_pinned' in data:
            session.is_pinned = bool(data.get('is_pinned'))
            fields.append('is_pinned')

        if fields:
            session.save(update_fields=fields)
        return JsonResponse({'ok': True})

    def delete(self, request, pk):
        session = ChatSession.objects.owned_by(request.user).filter(pk=pk).first()
        if session is None:
            return _not_found()
        session_id = session.id
        session.delete()
        UsageEvent.record(request.user, 'session.delete', session_id=session_id)
        logger.info('session.deleted session=%s user=%s', session_id, request.user.id)
        return JsonResponse({'ok': True})
