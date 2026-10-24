from django.conf import settings
from django.db import models
from django.utils import timezone


class DatasetQuerySet(models.QuerySet):
    """Row-level scoping helper. API code must read datasets through .owned_by(user)."""

    def owned_by(self, user):
        # An anonymous or missing user owns nothing. Refusing here rather than in each
        # caller keeps the invariant in one place.
        if user is None or not getattr(user, 'is_authenticated', False):
            return self.none()
        return self.filter(user=user)


class Dataset(models.Model):
    """An uploaded CSV/Excel file. Ownership is mandatory for any API access."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='datasets',
        null=True,
        blank=True,
        help_text="Owner of this dataset",
    )
    name = models.CharField(max_length=255, help_text="Give this dataset a name")
    file = models.FileField(upload_to='datasets/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    # Profile captured once at upload so the sidebar and prompt builder do not have
    # to re-read the file. `column_schema` is a list of column descriptors.
    row_count = models.IntegerField(default=0)
    column_count = models.IntegerField(default=0)
    size_bytes = models.BigIntegerField(default=0)
    column_schema = models.JSONField(default=list, blank=True)
    truncated = models.BooleanField(default=False)

    is_starred = models.BooleanField(default=False)
    last_analyzed_at = models.DateTimeField(null=True, blank=True)

    objects = DatasetQuerySet.as_manager()

    class Meta:
        ordering = ['-uploaded_at']
        indexes = [
            models.Index(fields=['user', '-uploaded_at'], name='dataset_user_recent_idx'),
        ]

    def __str__(self):
        return self.name

    @property
    def display_name(self):
        return self.name or (self.file.name.rsplit('/', 1)[-1] if self.file else 'Untitled')


class ChatSessionQuerySet(models.QuerySet):
    def owned_by(self, user):
        if user is None or not getattr(user, 'is_authenticated', False):
            return self.none()
        return self.filter(user=user)


class ChatSession(models.Model):
    """A conversation bound to one dataset. Messages are append-only."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='chat_sessions',
    )
    dataset = models.ForeignKey(
        Dataset,
        on_delete=models.CASCADE,
        related_name='sessions',
    )
    title = models.CharField(max_length=200, blank=True)
    is_pinned = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ChatSessionQuerySet.as_manager()

    class Meta:
        ordering = ['-is_pinned', '-updated_at']
        indexes = [
            models.Index(fields=['user', '-updated_at'], name='session_user_recent_idx'),
            models.Index(fields=['dataset'], name='session_dataset_idx'),
        ]

    def __str__(self):
        return self.title or f'Session #{self.pk}'

    def touch(self):
        """Mark the conversation as updated without a full save of other fields."""
        ChatSession.objects.filter(pk=self.pk).update(updated_at=timezone.now())


class ChatMessage(models.Model):
    USER = 'user'
    ASSISTANT = 'assistant'
    ROLE_CHOICES = [(USER, 'User'), (ASSISTANT, 'Assistant')]

    session = models.ForeignKey(
        ChatSession,
        on_delete=models.CASCADE,
        related_name='messages',
    )
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    content = models.TextField(blank=True)
    chart = models.JSONField(null=True, blank=True)
    # When the model had to derive a metric that was not a column, it records the
    # formula here so the assumption is visible beside the answer.
    method = models.CharField(max_length=300, blank=True)
    # The exact snippet that produced this answer. Shown on request so a person
    # can audit the computation rather than trusting the prose.
    code = models.TextField(blank=True)
    error = models.TextField(blank=True)
    elapsed_ms = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        indexes = [
            models.Index(fields=['session', 'created_at'], name='message_session_idx'),
        ]

    def __str__(self):
        return f'{self.role}: {self.content[:40]}'


class UserTier(models.Model):
    """Billing tier for a user. Drives the AI-query rate limit."""

    FREE = 'free'
    PRO = 'pro'
    TIER_CHOICES = [(FREE, 'Free'), (PRO, 'Pro')]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='tier',
    )
    tier = models.CharField(max_length=16, choices=TIER_CHOICES, default=FREE)
    stripe_customer_id = models.CharField(max_length=255, blank=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True)
    preferences = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user} ({self.tier})'


class UsageEvent(models.Model):
    """Append-only audit trail. Never stores row data or full prompts."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='usage_events',
    )
    kind = models.CharField(max_length=40)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', '-created_at'], name='usage_user_recent_idx'),
            models.Index(fields=['kind'], name='usage_kind_idx'),
        ]

    def __str__(self):
        return f'{self.kind} @ {self.created_at:%Y-%m-%d %H:%M}'

    @classmethod
    def record(cls, user, kind, **metadata):
        """Best-effort write. Analytics must never break the request it describes."""
        if user is None or not getattr(user, 'pk', None):
            return None
        try:
            return cls.objects.create(user=user, kind=kind, metadata=metadata)
        except Exception:  # pragma: no cover - defensive
            return None
