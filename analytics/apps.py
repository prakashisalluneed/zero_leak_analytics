from django.apps import AppConfig


class AnalyticsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'analytics'

    def ready(self):
        # Import Celery tasks so they register as soon as Django is set up,
        # independent of autodiscovery timing.
        from . import tasks  # noqa: F401
