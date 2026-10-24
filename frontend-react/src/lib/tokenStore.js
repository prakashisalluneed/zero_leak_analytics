const ACCESS_KEY = 'zla.access'
const REFRESH_KEY = 'zla.refresh'
const USER_KEY = 'zla.user'

function read(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    // Private browsing or a locked-down profile; fall back to memory.
    return memoryStore.get(key) ?? null
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    memoryStore.set(key, value)
  }
}

function remove(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    memoryStore.delete(key)
  }
}

const memoryStore = new Map()

export function getAccessToken() {
  return read(ACCESS_KEY)
}

export function getRefreshToken() {
  return read(REFRESH_KEY)
}

export function getStoredUser() {
  const raw = read(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function setTokens(access, refresh) {
  if (access) write(ACCESS_KEY, access)
  if (refresh) write(REFRESH_KEY, refresh)
}

export function setStoredUser(user) {
  if (user) write(USER_KEY, JSON.stringify(user))
}

export function clearTokens() {
  remove(ACCESS_KEY)
  remove(REFRESH_KEY)
  remove(USER_KEY)
}
