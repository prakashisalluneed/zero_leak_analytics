import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import Button from './Button.jsx'

/** A small, focus-trapping dialog used for confirmations and short forms. */
export default function Modal({ open, onClose, title, description, children, footer, width = 'max-w-md' }) {
  const panelRef = useRef(null)
  const previousFocus = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    previousFocus.current = document.activeElement
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
      }
      if (event.key !== 'Tab' || !panelRef.current) return

      // Keep focus inside the dialog while it is open.
      const focusable = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector(
        'input, textarea, button[data-autofocus], button',
      )
      target?.focus()
    }, 30)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(focusTimer)
      previousFocus.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="fade absolute inset-0 bg-ink/25 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`rise relative w-full ${width} rounded-lg border border-hairline bg-paper-raised p-5 shadow-[0_24px_60px_-24px_rgba(16,26,32,0.4)]`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="modal-title" className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[13px] leading-5 text-ink-soft">{description}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  )
}
