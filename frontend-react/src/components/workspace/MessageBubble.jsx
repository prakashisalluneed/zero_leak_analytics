import { Suspense, lazy } from 'react'
import { ChevronRight, CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { ErrorBoundary } from '../ui/Feedback.jsx'
import { Skeleton } from '../ui/Feedback.jsx'

const ChartRenderer = lazy(() => import('./ChartRenderer.jsx'))
const DataTable = lazy(() => import('./DataTable.jsx'))

const STAGES = {
  pending: 'Queued',
  loading_data: 'Reading the spreadsheet',
  generating_code: 'Working out the approach',
  executing: 'Computing',
  writing: 'Writing up',
}

function StageLine({ stage }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-muted">
      <span className="relative flex h-3 w-3 items-center justify-center">
        <span className="absolute h-1.5 w-1.5 rounded-full bg-seal" />
        <span className="absolute h-3 w-3 animate-ping rounded-full bg-seal/25" />
      </span>
      {STAGES[stage] ?? 'Working'}
    </span>
  )
}

function ChartSkeleton() {
  return (
    <div className="space-y-2.5" role="status" aria-label="Drawing chart">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-52 w-full" />
    </div>
  )
}

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user'
  const waiting = message.status === 'running' && !message.content

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(70ch,88%)] rounded-lg rounded-br-sm bg-ink px-3.5 py-2.5 text-[14px] leading-[22px] text-paper-raised">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <div className="max-w-[74ch]">
        {waiting ? (
          <StageLine stage={message.stage} />
        ) : message.status === 'error' ? (
          <div className="flex items-start gap-2.5 rounded-md border border-alarm/25 bg-alarm-wash px-3 py-2.5">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-alarm" />
            <div>
              <p className="text-[13px] font-medium text-alarm">That analysis could not finish</p>
              <p className="mt-0.5 text-[13px] leading-5 text-alarm/80">
                {message.error ?? 'The analysis failed.'}
              </p>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words font-serif text-[15.5px] leading-[26px] text-ink">
            {message.content}
            {message.status === 'running' ? <span className="caret" aria-hidden="true" /> : null}
          </p>
        )}

        {message.code ? (
          <details className="group mt-2">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-muted transition-colors hover:text-ink">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              Show computation
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-md border border-hairline bg-paper px-3 py-2.5 font-mono text-[11.5px] leading-[18px] text-ink-soft">
              <code>{message.code}</code>
            </pre>
            <p className="mt-1.5 font-mono text-[10px] leading-[15px] text-ink-muted">
              This is the exact code that ran against your data, after syntax validation.
            </p>
          </details>
        ) : null}

        {message.method ? (
          <p className="mt-2 flex items-start gap-1.5 rounded border border-hairline bg-paper px-2.5 py-1.5 font-mono text-[11px] leading-[16px] text-ink-muted">
            <Info className="mt-[2px] h-3 w-3 shrink-0" />
            <span>
              Derived metric · <span className="text-ink-soft">{message.method}</span>
            </span>
          </p>
        ) : null}

        {message.status === 'done' && message.stopped ? (
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Stopped following this answer. It may still have completed on the server.
          </p>
        ) : null}
      </div>

      {message.chart ? (
        <figure className="mt-3.5 rounded-md border border-hairline bg-paper-raised p-3.5">
          <Suspense fallback={<ChartSkeleton />}>
            <ErrorBoundary
              fallback={
                <div className="flex items-start gap-2 rounded border border-limit/30 bg-limit-wash px-3 py-2.5">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-limit" />
                  <p className="text-[12.5px] text-limit">
                    This chart could not be drawn from the returned data. The written
                    answer above is unaffected.
                  </p>
                </div>
              }
            >
              <ChartRenderer chart={message.chart} />
            </ErrorBoundary>
          </Suspense>
        </figure>
      ) : null}

      {message.table ? (
        <div className="mt-3.5">
          <Suspense fallback={<Skeleton className="h-32 w-full" />}>
            <ErrorBoundary fallback={null}>
              <DataTable table={message.table} />
            </ErrorBoundary>
          </Suspense>
        </div>
      ) : null}

      {message.truncated ? (
        <p className="mt-2 text-[12px] text-limit">
          This dataset was truncated to the first 200,000 rows for analysis.
        </p>
      ) : null}
    </div>
  )
}
