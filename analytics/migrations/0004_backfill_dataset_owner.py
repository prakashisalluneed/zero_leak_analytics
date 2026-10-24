from django.conf import settings
from django.db import migrations


def backfill_owners(apps, schema_editor):
    """Assign legacy ownerless datasets to the earliest superuser.

    RLS is enforced strictly, so a dataset with a NULL owner is invisible through
    the API. Reassigning them to an admin keeps the data reachable without exposing
    it to other users.
    """
    Dataset = apps.get_model('analytics', 'Dataset')
    User = apps.get_model('auth', 'User')

    orphans = Dataset.objects.filter(user__isnull=True)
    if not orphans.exists():
        return

    owner = User.objects.filter(is_superuser=True).order_by('id').first()
    if owner is None:
        # No admin exists to take ownership; leave the rows orphaned. They stay
        # unreachable via the API, which is the safe default.
        return

    orphans.update(user=owner)


def unassign_owners(apps, schema_editor):
    """No-op reverse: we cannot know which rows were originally ownerless."""


class Migration(migrations.Migration):

    dependencies = [
        ('analytics', '0003_usertier'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(backfill_owners, unassign_owners),
    ]
