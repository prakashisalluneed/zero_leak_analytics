from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .auth_views import (
    ChangePasswordView,
    CheckUsernameView,
    MeView,
    PreferencesView,
    register,
)
from .billing import BillingMeView, stripe_webhook
from .sessions import SessionDetailView, SessionListView
from .views import (
    DatasetDetailView,
    DatasetListView,
    DatasetPreviewView,
    SessionChatView,
    StatsView,
    TaskStatusView,
    health,
)

urlpatterns = [
    # System
    path('health/', health, name='health'),

    # Auth
    path('auth/register/', register, name='auth-register'),
    path('auth/login/', TokenObtainPairView.as_view(), name='token-obtain-pair'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('auth/me/', MeView.as_view(), name='auth-me'),
    path('auth/password/', ChangePasswordView.as_view(), name='auth-password'),
    path('auth/username-available/', CheckUsernameView.as_view(), name='auth-username-available'),
    path('preferences/', PreferencesView.as_view(), name='preferences'),

    # Datasets
    path('datasets/', DatasetListView.as_view(), name='dataset-list'),
    path('datasets/<int:pk>/', DatasetDetailView.as_view(), name='dataset-detail'),
    path('datasets/<int:pk>/preview/', DatasetPreviewView.as_view(), name='dataset-preview'),

    # Conversations
    path('sessions/', SessionListView.as_view(), name='session-list'),
    path('sessions/<int:pk>/', SessionDetailView.as_view(), name='session-detail'),
    path('sessions/<int:pk>/chat/', SessionChatView.as_view(), name='session-chat'),

    # Tasks
    path('tasks/<str:task_id>/', TaskStatusView.as_view(), name='task-status'),

    # Workspace
    path('stats/', StatsView.as_view(), name='stats'),

    # Billing
    path('billing/me/', BillingMeView.as_view(), name='billing-me'),
    path('billing/stripe/webhook/', stripe_webhook, name='stripe-webhook'),
]
