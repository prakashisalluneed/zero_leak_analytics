import { Component } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import Button from './Button.jsx'

export function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded bg-hairline-soft ${className}`}
      aria-hidden="true"
    />
  )
}

export function InlineError({ title = 'Something went wrong', message, onReset, resetLabel = 'Try again' }) {
  return (
    <div className="rounded-md border border-alarm/25 bg-alarm-wash p-3.5">
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-alarm" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-alarm">{title}</p>
          {message ? <p className="mt-1 text-[13px] leading-5 text-alarm/80">{message}</p> : null}
          {onReset ? (
            <Button variant="secondary" size="sm" onClick={onReset} className="mt-2.5">
              <RefreshCw className="h-3 w-3" />
              {resetLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}>
      {Icon ? (
        <span className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-paper-raised text-ink-muted">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      ) : null}
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-xs text-[13px] leading-5 text-ink-soft text-pretty">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
    this.props.onError?.(error, info)
  }

  reset() {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const { fallback } = this.props
    if (typeof fallback === 'function') return fallback({ error, reset: this.reset })
    if (fallback) return fallback
    return <InlineError message={error.message} onReset={this.reset} />
  }
}
