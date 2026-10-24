import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { login as loginRequest, register as registerRequest } from '../api/auth'
import { apiJson, apiSend } from '../api/client'
import { clearTokens, getAccessToken, getStoredUser, setStoredUser } from '../lib/tokenStore'

const AuthContext = createContext(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getAccessToken())
  const [user, setUser] = useState(() => getStoredUser())
  const [booting, setBooting] = useState(() => Boolean(getAccessToken()))

  const logout = useCallback(() => {
    clearTokens()
    setToken(null)
    setUser(null)
  }, [])

  const adopt = useCallback((nextUser) => {
    setStoredUser(nextUser)
    setUser(nextUser)
    setToken(getAccessToken())
  }, [])

  const login = useCallback(
    async (username, password) => {
      await loginRequest(username, password)
      setToken(getAccessToken())
      // The login endpoint returns tokens only; the profile follows immediately.
      const profile = await apiJson('/api/auth/me/')
      adopt(profile.user)
      return profile.user
    },
    [adopt],
  )

  const register = useCallback(
    async (payload) => {
      const data = await registerRequest(payload)
      adopt(data.user)
      return data.user
    },
    [adopt],
  )

  // Re-hydrate the profile on boot so a stale cached user (renamed, upgraded)
  // corrects itself without a manual sign-out.
  useEffect(() => {
    if (!token) return undefined
    let cancelled = false
    apiJson('/api/auth/me/')
      .then((data) => {
        if (!cancelled) adopt(data.user)
      })
      .catch(() => {
        // A failed refresh has already cleared tokens and fired the event below.
      })
      .finally(() => {
        if (!cancelled) setBooting(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onUnauthorized = () => logout()
    window.addEventListener('zla:unauthorized', onUnauthorized)
    return () => window.removeEventListener('zla:unauthorized', onUnauthorized)
  }, [logout])

  const updateUser = useCallback(
    async (patch) => {
      const data = await apiSend('/api/auth/me/', 'PATCH', patch)
      adopt(data.user)
      return data.user
    },
    [adopt],
  )

  const value = useMemo(
    () => ({
      isAuthenticated: Boolean(token),
      booting,
      user,
      login,
      register,
      logout,
      updateUser,
      tier: user?.tier ?? 'free',
    }),
    [token, booting, user, login, register, logout, updateUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
