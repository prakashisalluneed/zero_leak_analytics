import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Columns3, FileSpreadsheet, MessageSquarePlus, Trash2 } from 'lucide-react'
import OverviewPage from './OverviewPage.jsx'
import ChatPanel from '../components/workspace/ChatPanel.jsx'
import DataPreview from '../components/workspace/DataPreview.jsx'
import Button from '../components/ui/Button.jsx'
import Modal from '../components/ui/Modal.jsx'
import { InlineError, Skeleton } from '../components/ui/Feedback.jsx'
import { useWorkspace } from '../contexts/WorkspaceContext.jsx'
import { useToast } from '../contexts/ToastContext.jsx'
import { fetchDataset } from '../api/datasets'
import { createSession, deleteSession, fetchSession } from '../api/sessions'
import { formatRelative } from '../lib/format.js'

export default function WorkspacePage() {
  const { datasetId, sessionId } = useParams()

  if (!datasetId && !sessionId) return <OverviewPage />

  if (sessionId) return <SessionWorkspace sessionId={Number(sessionId)} />

  return <DatasetWorkspace datasetId={Number(datasetId)} />
}

/* ---------------------------------------------------------------------------
   A dataset with no conversation selected: the dataset is the subject, and the
   panel explains what it contains before the first question.
--------------------------------------------------------------------------- */

function DatasetWorkspace({ datasetId }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { refresh } = useWorkspace()
  const [starting, setStarting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const { removeDataset } = useWorkspace()

  // Tag the result with the id it belongs to; a different id renders as loading
  // without needing a synchronous state reset in the effect.
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchDataset(datasetId)
      .then((row) => {
        if (!cancelled) setLoaded({ id: datasetId, row, error: null })
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ id: datasetId, row: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [datasetId])

  const current = loaded?.id === datasetId ? loaded : null
  const dataset = current?.row ?? null
  const error = current?.error ?? null

  const startConversation = async () => {
    if (starting) return
    setStarting(true)
    try {
      const session = await createSession(datasetId)
      refresh()
      navigate(`/app/sessions/${session.id}`)
    } catch (err) {
      toast.error('Could not start a conversation', err.message)
      setStarting(false)
    }
  }

  const handleDelete = async () => {
    try {
      await removeDataset(datasetId)
      toast.success('Dataset deleted', 'The file and its conversations were removed.')
      navigate('/app', { replace: true })
    } catch (err) {
      toast.error('Delete failed', err.message)
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <InlineError title="This dataset is not available" message={error} />
        </div>
      </div>
    )
  }

  if (!dataset) return <DatasetShellSkeleton />

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline bg-paper-raised px-5 py-3.5 sm:px-7">
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {dataset.name}
              </h1>
              <p className="mt-0.5 font-mono text-[10.5px] text-ink-muted">
                Added {formatRelative(dataset.uploaded_at)}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setPreviewOpen(true)}
                className="xl:hidden"
                aria-label="Open data preview"
              >
                <Columns3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setConfirmDelete(true)}
                aria-label="Delete dataset"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
            <div className="w-full max-w-md text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-md border border-hairline bg-paper-raised text-ink-muted">
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <h2 className="mt-4 font-serif text-[21px] leading-tight text-ink">
                Ask this dataset a question
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-[21px] text-ink-soft text-pretty">
                Every answer is computed against the actual rows, then written up in plain
                language. Charts are optional — say so if you want one.
              </p>
              <Button
                size="lg"
                variant="seal"
                className="mt-5"
                loading={starting}
                onClick={startConversation}
              >
                <MessageSquarePlus className="h-4 w-4" />
                Start a conversation
              </Button>

              <div className="mt-7 grid gap-2 text-left">
                {[
                  'Summarise the columns and what each one appears to measure.',
                  'Which categories contribute the most, and by how much?',
                  'Chart the trend over time and explain the shape.',
                ].map((example) => (
                  <p
                    key={example}
                    className="rounded-md border border-hairline bg-paper-raised px-3 py-2 text-[12.5px] text-ink-soft"
                  >
                    {example}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="hidden w-[320px] shrink-0 border-l border-hairline bg-paper xl:block">
          <DataPreview dataset={dataset} />
        </aside>
      </div>

      {previewOpen ? (
        <div className="fixed inset-0 z-50 xl:hidden">
          <div
            className="absolute inset-0 bg-ink/25"
            onClick={() => setPreviewOpen(false)}
            aria-hidden="true"
          />
          <div className="rise absolute inset-y-0 right-0 w-[min(92vw,380px)] overflow-y-auto border-l border-hairline bg-paper">
            <DataPreview dataset={dataset} onClose={() => setPreviewOpen(false)} />
          </div>
        </div>
      ) : null}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${dataset.name}?`}
        description="The file and every conversation attached to it will be removed from this machine. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete dataset
            </Button>
          </>
        }
      />
    </>
  )
}

function DatasetShellSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-hairline bg-paper-raised px-5 py-3.5 sm:px-7">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-2 h-2.5 w-28" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Skeleton className="h-32 w-64" />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------------------
   A saved conversation. The chat owns the left side; the dataset profile sits in
   a persistent right rail on wide screens.
--------------------------------------------------------------------------- */

function SessionWorkspace({ sessionId }) {
  const navigate = useNavigate()
  const toast = useToast()
  const { refresh } = useWorkspace()

  const [loaded, setLoaded] = useState(null)
  const [railOpen, setRailOpen] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchSession(sessionId)
      .then(async (row) => {
        if (cancelled) return
        const ds = await fetchDataset(row.dataset_id)
        if (!cancelled) setLoaded({ id: sessionId, session: row, dataset: ds, error: null })
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ id: sessionId, session: null, dataset: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const current = loaded?.id === sessionId ? loaded : null
  const session = current?.session ?? null
  const dataset = current?.dataset ?? null
  const error = current?.error ?? null

  const handleDeleted = useCallback(async () => {
    try {
      await deleteSession(sessionId)
      refresh()
      toast.success('Conversation deleted')
      navigate(dataset ? `/app/datasets/${dataset.id}` : '/app', { replace: true })
    } catch (err) {
      toast.error('Delete failed', err.message)
    }
  }, [sessionId, dataset, refresh, toast, navigate])

  const initialMessages = useMemo(() => {
    if (!session) return []
    return session.messages.map((message) => ({
      id: `db-${message.id}`,
      role: message.role,
      content: message.content,
      chart: message.chart,
      method: message.method,
      code: message.code,
      error: message.error,
      elapsed_ms: message.elapsed_ms,
      status: message.error ? 'error' : 'done',
    }))
  }, [session])

  useEffect(() => {
    if (!session) return
    if (session.title && session.title !== 'New conversation') {
      document.title = `${session.title} · Zero Leak Analytics`
    }
    return () => {
      document.title = 'Zero Leak Analytics'
    }
  }, [session])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <InlineError title="This conversation is not available" message={error} />
          <Button variant="secondary" className="mt-3" onClick={() => navigate('/app')}>
            Back to overview
          </Button>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="border-b border-hairline bg-paper-raised px-5 py-3.5">
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex-1 px-5 py-8">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="mt-6 h-24 w-full" />
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <ChatPanel
          key={session.id}
          session={session}
          dataset={dataset}
          initialMessages={initialMessages}
          railOpen={railOpen}
          onToggleRail={() => setRailOpen((value) => !value)}
          onDelete={() => setConfirmDelete(true)}
        />

        {railOpen && dataset ? (
          <aside className="hidden w-[320px] shrink-0 border-l border-hairline bg-paper xl:block">
            <DataPreview dataset={dataset} onClose={() => setRailOpen(false)} />
          </aside>
        ) : null}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this conversation?"
        description="Every question, answer, and chart in this thread will be removed. The dataset stays."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={handleDeleted}>
              Delete conversation
            </Button>
          </>
        }
      />
    </>
  )
}
