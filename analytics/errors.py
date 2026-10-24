"""Uniform JSON error responses for the REST API.

The SPA renders one shape for every failure, so DRF's default
``{"detail": ...}`` envelope is normalised to ``{"error", "code"}``.
"""
from rest_framework.views import exception_handler as drf_exception_handler


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    data = response.data
    message = None
    code = getattr(exc, 'default_code', 'error')

    if isinstance(data, dict):
        # DRF's own errors use "detail"; validation errors are field lists.
        if 'detail' in data:
            message = str(data['detail'])
        else:
            fields = []
            for field, errors in data.items():
                if isinstance(errors, (list, tuple)):
                    fields.append(f'{field}: {", ".join(str(e) for e in errors)}')
                else:
                    fields.append(f'{field}: {errors}')
            message = '; '.join(fields) or None
    elif isinstance(data, (list, tuple)):
        message = ', '.join(str(item) for item in data)
    else:
        message = str(data)

    response.data = {
        'error': message or 'Something went wrong.',
        'code': code,
    }
    return response
