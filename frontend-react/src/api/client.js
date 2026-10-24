import { clearTokens, getAccessToken, getRefreshToken, setTokens, setStoredUser } from '../lib/tokenStore'

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.code = data?.code ?? 'error'
    this.fields = data?.fields ?? null
  }
}

export async function toApiError(response) {
  let data = null
  try {
    data = await response.json()
  } catch {
    // Non-JSON body (proxy error page, network gate). Keep data null.
  }

  const fallback =
    response.status === 429
      ? 'Too many requests. Wait a moment and try again.'
      : response.status >= 500
        ? 'The server could not complete that request.'
        : `Request failed (${response.status})`

  const message =
    data?.error ||
    data?.detail ||
    (Array.isArray(data) ? data.join(', ') : null) ||
    fallback

  return new ApiError(message, response.status, data)
}

let refreshInFlight = null

function refreshAccessToken() {
  const refresh = getRefreshToken()
  if (!refresh) {
    return Promise.reject(new ApiError('Your session has expired. Sign in again.', 401))
  }

  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then(async (response) => {
        if (!response.ok) throw await toApiError(response)
        const data = await response.json()
        setTokens(data.access, refresh)
        return data.access
      })
      .finally(() => {
        refreshInFlight = null
      })
  }

  return refreshInFlight
}

export async function apiFetch(path, { auth = true, retry = true, headers, ...options } = {}) {
  const requestHeaders = { ...headers }
  if (auth) {
    const token = getAccessToken()
    if (token) requestHeaders.Authorization = `Bearer ${token}`
  }

  const response = await fetch(path, { ...options, headers: requestHeaders })

  if (response.status === 401 && auth && retry) {
    try {
      const token = await refreshAccessToken()
      requestHeaders.Authorization = `Bearer ${token}`
      return await fetch(path, { ...options, headers: requestHeaders })
    } catch (error) {
      clearTokens()
      window.dispatchEvent(new Event('zla:unauthorized'))
      throw error
    }
  }

  return response
}

/** Fetch JSON, throwing a normalized ApiError on any non-2xx response. */
export async function apiJson(path, options) {
  const response = await apiFetch(path, options)
  if (!response.ok) throw await toApiError(response)
  if (response.status === 204) return null
  return response.json()
}

export async function apiSend(path, method, body, options = {}) {
  return apiJson(path, {
    ...options,
    method,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function cacheUser(user) {
  if (user) setStoredUser(user)
}
