import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  ChartNoAxesColumn,
  Database,
  FileSpreadsheet,
  MessageSquareText,
  Upload,
} from 'lucide-react'
import Button from '../components/ui/Button.jsx'
import { EmptyState, InlineError, Skeleton } from '../components/ui/Feedback.jsx'
import { useWorkspace } from '../contexts/WorkspaceContext.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { fetchStats } from '../api/datasets'
import { describeDataset, formatBytes, formatCompact, formatRelative } from '../lib/format.js'

function Stat({ label, value, hint }) {
  return (
    <div className="border-t border-hairline pt-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">{label}</p>
      <p className="mt-1.5 font-mono text-[26px] leading-none tracking-[-0.02em] text-ink tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p> : null}
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="border-t border-hairline pt-4">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-2.5 h-6 w-14" />
        </div>
      ))}
    </div>
  )
}

export default function OverviewPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { datasets, loadingDatasets } = useWorkspace()
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchStats()
      .then((data) => {
        if (!cancelled) setStats(data)
      })
      .catch((error) => {
        if (!cancelled) setStatsError(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const firstFour = datasets.slice(0, 4)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = (user?.display_name ?? '').split(' ')[0]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-[27px] leading-tight tracking-[-0.01em] text-ink sm:text-[31px]">
              {greeting}
              {firstName ? `, ${firstName}` : ''}.
            </h1>
            <p className="mt-1.5 text-[14px] text-ink-soft">
              Everything below runs on this machine.
            </p>
          </div>
          <Button onClick={() => navigate('/app?upload=1')} variant="secondary">
            <Upload className="h-3.5 w-3.5" />
            Add a dataset
          </Button>
        </header>

        <section className="mt-9">
          {statsError ? (
            <InlineError title="Could not load your activity" message={statsError} />
          ) : !stats ? (
            <StatsSkeleton />
          ) : (
            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Datasets"
                value={formatCompact(stats.datasets)}
                hint={
                  stats.rows_under_analysis
                    ? `${formatCompact(stats.rows_under_analysis)} rows indexed`
                    : 'Nothing uploaded yet'
                }
              />
              <Stat
                label="Conversations"
                value={formatCompact(stats.sessions)}
                hint={stats.sessions === 1 ? '1 thread' : `${stats.sessions} threads`}
              />
              <Stat
                label="Questions asked"
                value={formatCompact(stats.questions)}
                hint={
                  stats.questions > 0
                    ? `${formatCompact(stats.charts)} with charts`
                    : 'Ask your first question'
                }
              />
              <Stat
                label="Local storage"
                value={formatBytes(stats.storage_bytes)}
                hint="On this disk"
              />
            </div>
          )}
        </section>

        <section className="mt-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Your datasets</h2>
            {datasets.length > 4 ? (
              <span className="font-mono text-[11px] text-ink-muted">
                showing 4 of {datasets.length}
              </span>
            ) : null}
          </div>

          {loadingDatasets ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <Skeleton key={index} className="h-[86px] rounded-md" />
              ))}
            </div>
          ) : firstFour.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline">
              <EmptyState
                icon={FileSpreadsheet}
                title="No datasets yet"
                description="Upload a CSV or Excel file. It is read here and never uploaded anywhere else."
                action={
                  <Button onClick={() => navigate('/app?upload=1')}>
                    <Upload className="h-3.5 w-3.5" />
                    Choose a file
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {firstFour.map((dataset) => (
                <li key={dataset.id}>
                  <Link
                    to={`/app/datasets/${dataset.id}`}
                    className="group flex h-full flex-col justify-between rounded-md border border-hairline bg-paper-raised p-4 transition-colors hover:border-ink/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-paper text-ink-muted">
                        <FileSpreadsheet className="h-4 w-4" />
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-ink-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </div>
                    <div className="mt-3">
                      <p className="truncate text-[13.5px] font-medium text-ink">{dataset.name}</p>
                      <p className="mt-0.5 font-mono text-[10.5px] text-ink-muted">
                        {describeDataset(dataset)}
                      </p>
                      <p className="mt-1.5 text-[11.5px] text-ink-muted">
                        Added {formatRelative(dataset.uploaded_at)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {stats && stats.recent_sessions.length > 0 ? (
          <section className="mt-10">
            <h2 className="mb-3 text-[14px] font-semibold text-ink">Recent conversations</h2>
            <ul className="divide-y divide-hairline rounded-md border border-hairline bg-paper-raised">
              {stats.recent_sessions.map((session) => (
                <li key={session.id}>
                  <Link
                    to={`/app/sessions/${session.id}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-paper"
                  >
                    <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{session.title}</span>
                      <span className="block truncate font-mono text-[10.5px] text-ink-muted">
                        {session.dataset_name} · {session.message_count} messages
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">
                      {formatRelative(session.updated_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-hairline pt-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-muted">
          <span className="flex items-center gap-1.5">
            <Database className="h-3 w-3" /> Local model
          </span>
          <span className="flex items-center gap-1.5">
            <ChartNoAxesColumn className="h-3 w-3" /> Computed answers
          </span>
          <span className="flex items-center gap-1.5">
            <Database className="h-3 w-3" /> No outbound data
          </span>
        </footer>
      </div>
    </div>
  )
}
