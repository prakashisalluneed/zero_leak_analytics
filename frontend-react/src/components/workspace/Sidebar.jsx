import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronsUpDown,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  Plus,
  Settings,
  Star,
  Upload,
  X,
} from 'lucide-react'
import Button from '../ui/Button.jsx'
import { Wordmark } from '../ui/Seal.jsx'
import { EmptyState, Skeleton } from '../ui/Feedback.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useWorkspace } from '../../contexts/WorkspaceContext.jsx'
import { describeDataset, formatRelative, initials } from '../../lib/format.js'

function SectionHeading({ children, action }) {
  return (
    <div className="mb-1.5 flex items-center justify-between px-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-ink-muted">
        {children}
      </span>
      {action}
    </div>
  )
}

function DatasetRow({ dataset, active, onToggleStar }) {
  return (
    <div
      className={[
        'group relative flex items-center rounded-md transition-colors',
        active ? 'bg-white shadow-[0_0_0_1px_var(--color-hairline)]' : 'hover:bg-hairline-soft/70',
      ].join(' ')}
    >
      <Link
        to={`/app/datasets/${dataset.id}`}
        aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-2 pr-1"
      >
        <span
          className={[
            'flex h-6 w-6 shrink-0 items-center justify-center rounded',
            active ? 'bg-seal-wash text-seal' : 'bg-paper text-ink-muted',
          ].join(' ')}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">
            {dataset.name}
          </span>
          <span className="block truncate font-mono text-[10.5px] text-ink-muted">
            {describeDataset(dataset)}
          </span>
        </span>
      </Link>

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          onToggleStar(dataset)
        }}
        aria-label={dataset.is_starred ? `Unpin ${dataset.name}` : `Pin ${dataset.name}`}
        className={[
          'mr-1 rounded p-1 transition-opacity',
          dataset.is_starred
            ? 'text-limit opacity-100'
            : 'text-ink-muted opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
        ].join(' ')}
      >
        <Star className="h-3.5 w-3.5" fill={dataset.is_starred ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

function SidebarSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-1.5 px-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-2.5 py-1.5">
          <Skeleton className="h-6 w-6 rounded" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-2.5 w-3/4" />
            <Skeleton className="h-2 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Sidebar({ open, onClose, onUpload }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { datasets, sessions, loadingDatasets, loadingSessions, reloadSessions, toggleStar, error } =
    useWorkspace()

  const [accountOpen, setAccountOpen] = useState(false)

  const pinned = datasets.filter((dataset) => dataset.is_starred)
  const recent = datasets.filter((dataset) => !dataset.is_starred).slice(0, 8)
  const recentSessions = sessions.slice(0, 6)

  const signOut = () => {
    logout()
    navigate('/signin', { replace: true })
  }

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col border-r border-hairline bg-paper',
          'transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
        aria-label="Workspace navigation"
      >
        <div className="flex items-center justify-between px-3 py-3.5">
          <Link to="/app" onClick={onClose}>
            <Wordmark />
          </Link>
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-2.5 pb-2">
          <Button
            className="w-full justify-start"
            size="sm"
            onClick={() => {
              onUpload?.()
              onClose()
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New dataset
          </Button>
        </div>

        <nav className="px-2.5" aria-label="Primary">
          <NavLink
            to="/app"
            end
            onClick={onClose}
            className={({ isActive }) =>
              [
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                isActive
                  ? 'bg-white font-medium text-ink shadow-[0_0_0_1px_var(--color-hairline)]'
                  : 'text-ink-soft hover:bg-hairline-soft/70 hover:text-ink',
              ].join(' ')
            }
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Overview
          </NavLink>
        </nav>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pb-2 [scrollbar-gutter:stable]">
          {error ? (
            <p className="mx-2.5 mb-3 rounded border border-alarm/25 bg-alarm-wash px-2.5 py-2 text-[12px] text-alarm">
              {error}
            </p>
          ) : null}

          {pinned.length > 0 ? (
            <section className="mb-4">
              <SectionHeading>Pinned</SectionHeading>
              <ul className="space-y-0.5 px-1">
                {pinned.map((dataset) => (
                  <li key={dataset.id}>
                    <DatasetRow
                      dataset={dataset}
                      active={location.pathname === `/app/datasets/${dataset.id}`}
                      onToggleStar={toggleStar}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mb-4">
            <SectionHeading>Datasets</SectionHeading>
            {loadingDatasets ? (
              <SidebarSkeleton />
            ) : recent.length === 0 ? (
              pinned.length === 0 ? (
                <EmptyState
                  icon={Upload}
                  title="No datasets yet"
                  description="Add a CSV or Excel file to start asking questions."
                  className="py-6"
                />
              ) : null
            ) : (
              <ul className="space-y-0.5 px-1">
                {recent.map((dataset) => (
                  <li key={dataset.id}>
                    <DatasetRow
                      dataset={dataset}
                      active={location.pathname === `/app/datasets/${dataset.id}`}
                      onToggleStar={toggleStar}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {recentSessions.length > 0 ? (
            <section>
              <SectionHeading
                action={
                  <button
                    type="button"
                    onClick={() => reloadSessions()}
                    className="rounded p-0.5 text-ink-muted hover:text-ink"
                    aria-label="Refresh conversations"
                  >
                    <ChevronsUpDown className="h-3 w-3" />
                  </button>
                }
              >
                Conversations
              </SectionHeading>
              {loadingSessions ? (
                <SidebarSkeleton rows={2} />
              ) : (
                <ul className="space-y-0.5 px-1">
                  {recentSessions.map((session) => {
                    const active = location.pathname === `/app/sessions/${session.id}`
                    return (
                      <li key={session.id}>
                        <Link
                          to={`/app/sessions/${session.id}`}
                          onClick={onClose}
                          aria-current={active ? 'page' : undefined}
                          className={[
                            'flex items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors',
                            active
                              ? 'bg-white shadow-[0_0_0_1px_var(--color-hairline)]'
                              : 'hover:bg-hairline-soft/70',
                          ].join(' ')}
                        >
                          <MessageSquareText className="mt-[2px] h-3.5 w-3.5 shrink-0 text-ink-muted" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] text-ink">
                              {session.title}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-ink-muted">
                              {session.dataset_name} · {formatRelative(session.updated_at)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          ) : null}
        </div>

        <div className="border-t border-hairline p-2.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setAccountOpen((value) => !value)}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hairline-soft/70"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[10.5px] font-semibold text-paper-raised">
                {initials(user?.display_name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {user?.display_name ?? 'Account'}
                </span>
                <span className="block truncate font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                  {user?.tier ?? 'free'} plan
                </span>
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
            </button>

            {accountOpen ? (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setAccountOpen(false)}
                  aria-hidden="true"
                />
                <div
                  role="menu"
                  className="fade absolute bottom-full left-0 z-50 mb-1.5 w-full overflow-hidden rounded-md border border-hairline bg-paper-raised py-1 shadow-[0_12px_32px_-16px_rgba(16,26,32,0.35)]"
                >
                  <Link
                    to="/app/settings"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false)
                      onClose()
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-ink-soft hover:bg-hairline-soft hover:text-ink"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Settings
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={signOut}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink-soft hover:bg-hairline-soft hover:text-ink"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  )
}
