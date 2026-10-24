import { cacheUser, toApiError } from './client'
import { setStoredUser, setTokens } from '../lib/tokenStore'

export async function login(username, password) {
  const response = await fetch('/api/auth/login/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

  if (!response.ok) {
    const error = await toApiError(response)
    // DRF returns "No active account found with the given credentials" — accurate
    // but not useful in a sign-in form.
    if (response.status === 401) {
      throw new Error('That username and password do not match.')
    }
    throw error
  }

  const data = await response.json()
  setTokens(data.access, data.refresh)
  return data
}

export async function register({ username, email, password, firstName, lastName }) {
  const response = await fetch('/api/auth/register/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email,
      password,
      first_name: firstName,
      last_name: lastName,
    }),
  })

  if (!response.ok) throw await toApiError(response)

  const data = await response.json()
  setTokens(data.access, data.refresh)
  setStoredUser(data.user)
  return data
}

export async function checkUsername(username) {
  const response = await fetch(
    `/api/auth/username-available/?username=${encodeURIComponent(username)}`,
  )
  if (!response.ok) return { available: true, reason: '' }
  return response.json()
}

export { cacheUser }
