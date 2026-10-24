from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path

from frontend.views import spa_index

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('analytics.urls')),  # API traffic for the React app
    # Everything else renders the React SPA. Hashed assets (/assets/*) are served
    # by WhiteNoise (WHITENOISE_ROOT) before URL resolution reaches this catch-all.
    re_path(r'^(?!api(?:/|$)|admin(?:/|$)|static(?:/|$)|media(?:/|$)).*$', spa_index, name='spa'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
