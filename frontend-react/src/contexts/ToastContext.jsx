import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}

const ICONS = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
}

const ACCENTS = {
  success: 'text-seal',
  error: 'text-alarm',
  info: 'text-ink-muted',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (toast) => {
      const id = (counter.current += 1)
      const next = { id, type: 'info', duration: 4500, ...toast }
      setToasts((current) => [...current.slice(-3), next])
      if (next.duration > 0) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), next.duration))
      }
      return id
    },
    [dismiss],
  )

  const value = useMemo(
    () => ({
      dismiss,
      push,
      success: (title, message) => push({ type: 'success', title, message }),
      error: (title, message) => push({ type: 'error', title, message, duration: 7000 }),
      info: (title, message) => push({ type: 'info', title, message }),
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-5 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] ?? Info
          return (
            <div
              key={toast.id}
              role="status"
              className="fade pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border border-hairline bg-paper-raised px-4 py-3 shadow-[0_8px_24px_-12px_rgba(16,26,32,0.28)]"
            >
              <Icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${ACCENTS[toast.type]}`} />
              <div className="min-w-0 flex-1">
                {toast.title ? (
                  <p className="text-[13px] font-medium leading-5 text-ink">{toast.title}</p>
                ) : null}
                {toast.message ? (
                  <p className="mt-0.5 break-words text-[13px] leading-5 text-ink-soft">
                    {toast.message}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="-mr-1 rounded p-1 text-ink-muted transition-colors hover:bg-hairline-soft hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
