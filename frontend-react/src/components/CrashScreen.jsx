import { RefreshCw, TriangleAlert } from 'lucide-react'
import Button from './ui/Button.jsx'

export default function CrashScreen({ error, onReset }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md rounded-lg border border-hairline bg-paper-raised p-6">
        <div className="flex items-center gap-2.5 text-alarm">
          <TriangleAlert className="h-5 w-5" />
          <h1 className="text-[15px] font-semibold">Something on this page stopped working</h1>
        </div>
        <p className="mt-2.5 text-[13px] leading-5 text-ink-soft">
          {error?.message ?? 'An unexpected error occurred while rendering.'}
        </p>
        <p className="mt-1.5 text-[12.5px] leading-5 text-ink-muted">
          Your datasets and conversations are unaffected.
        </p>
        <div className="mt-5 flex gap-2">
          <Button onClick={onReset}>
            <RefreshCw className="h-3.5 w-3.5" />
            Reopen the view
          </Button>
          <Button variant="secondary" onClick={() => window.location.assign('/app')}>
            Go to workspace
          </Button>
        </div>
      </div>
    </div>
  )
}
