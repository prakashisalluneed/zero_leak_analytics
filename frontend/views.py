from pathlib import Path

from django.conf import settings
from django.http import HttpResponse

_INDEX_PATH = Path(settings.FRONTEND_DIST) / 'index.html'

# Shown only when the React app has not been built yet. In Docker the nginx
# frontend image serves the SPA, so this page is a local-development aid.
_BUILD_REQUIRED_HTML = """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Zero Leak Analytics - build the frontend</title>
    <style>
        body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
               background: #fafafa; color: #171717; margin: 0;
               display: flex; min-height: 100vh; align-items: center; justify-content: center; }
        main { max-width: 30rem; padding: 2rem; background: #fff; border: 1px solid #e5e5e5;
               border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
        h1 { font-size: 1.05rem; margin: 0 0 .5rem; }
        p { color: #525252; line-height: 1.6; margin: .5rem 0; font-size: .9rem; }
        code { background: #f5f5f5; border: 1px solid #e5e5e5; border-radius: 6px;
               padding: .1rem .35rem; font-size: .85rem; }
    </style>
</head>
<body>
    <main>
        <h1>The frontend has not been built yet</h1>
        <p>The API is running, but Django could not find the compiled React app at
           <code>frontend-react/dist</code>.</p>
        <p>Build it once with:</p>
        <p><code>cd frontend-react &amp;&amp; npm install &amp;&amp; npm run build</code></p>
        <p>Then reload this page. The REST API is available under <code>/api/</code>
           and the admin under <code>/admin/</code>.</p>
    </main>
</body>
</html>
"""


def spa_index(request):
    """Serve the compiled React SPA shell for the root and any client-side route."""
    try:
        html = _INDEX_PATH.read_text(encoding='utf-8')
    except (OSError, ValueError):
        return HttpResponse(_BUILD_REQUIRED_HTML, content_type='text/html')
    return HttpResponse(html, content_type='text/html')
