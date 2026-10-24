import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, PanelRightClose, PanelRightOpen, Sparkle, Square, Trash2 } from 'lucide-react'
import Button from '../ui/Button.jsx'
import MessageBubble from './MessageBubble.jsx'
import { ErrorBoundary } from '../ui/Feedback.jsx'
import { useChatTask } from '../../hooks/useChatTask'
import { useWorkspace } from '../../contexts/WorkspaceContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { describeDataset } from '../../lib/format.js'

const SUGGESTIONS = [
  'Summarise this dataset in three sentences.',
  'Which categories are largest, and how far apart are they?',
  'Chart the trend over time.',
  'Are there missing values or outliers I should know about?',
]

export default function ChatPanel({
  session,
  dataset,
  initialMessages,
  railOpen,
  onToggleRail,
  onDelete,
}) {
  const toast = useToast()
  const { reloadSessions } = useWorkspace()
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const pinnedToBottom = useRef(true)

  const handleComplete = useCallback(() => {
    // The sidebar title and ordering are derived server-side from the first
    // question, so refresh it once a run finishes.
    reloadSessions()
  }, [reloadSessions])

  const { messages, isAnalyzing, send, stop } = useChatTask({
    sessionId: session.id,
    initialMessages,
    onComplete: handleComplete,
  })

  const handleError = useCallback(
    (message) => toast.error('Analysis failed', message),
    [toast],
  )
  // The hook surfaces per-message errors itself; a toast would duplicate it, so
  // this stays a no-op beyond the inline state.
  void handleError

  // Follow the stream only while the reader is already at the bottom.
  useEffect(() => {
    const node = scrollRef.current
    if (!node || !pinnedToBottom.current) return
    node.scrollTop = node.scrollHeight
  }, [messages])

  const onScroll = () => {
    const node = scrollRef.current
    if (!node) return
    pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
  }

  const submit = async (event) => {
    event?.preventDefault()
    const question = input.trim()
    if (!question || isAnalyzing) return

    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    pinnedToBottom.current = true
    await send(question)
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit(event)
    }
  }

  const onChange = (event) => {
    setInput(event.target.value)
    const element = event.target
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`
  }

  const applySuggestion = (suggestion) => {
    setInput(suggestion)
    textareaRef.current?.focus()
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper-raised">
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-5 py-3 sm:px-7">
        <div className="min-w-0">
          <h1 className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-ink">
            {session.title && session.title !== 'New conversation'
              ? session.title
              : 'New conversation'}
          </h1>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-ink-muted">
            {dataset ? dataset.name : session.dataset_name}
            {dataset ? ` · ${describeDataset(dataset)}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span
            className={[
              'mr-1 hidden items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] sm:inline-flex',
              isAnalyzing
                ? 'border-seal/30 bg-seal-wash text-seal'
                : 'border-hairline text-ink-muted',
            ].join(' ')}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isAnalyzing ? 'bg-seal' : 'bg-hairline'}`}
            />
            {isAnalyzing ? 'Working' : 'Ready'}
          </span>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleRail}
            className="hidden xl:inline-flex"
            aria-label={railOpen ? 'Hide data panel' : 'Show data panel'}
          >
            {railOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label="Delete conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7"
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-[74ch] flex-col justify-center">
            <Sparkle className="h-4 w-4 text-seal" />
            <h2 className="mt-3 font-serif text-[22px] leading-tight text-ink">
              What would you like to know?
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-[21px] text-ink-soft">
              The answer is computed from the rows themselves, then written out. Nothing is
              sent off this machine.
            </p>

            <ul className="mt-6 grid gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => applySuggestion(suggestion)}
                    className="w-full rounded-md border border-hairline bg-paper px-3 py-2 text-left text-[13px] text-ink-soft transition-colors hover:border-ink/20 hover:bg-white hover:text-ink"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[74ch] flex-col gap-7">
            <ErrorBoundary fallback={null}>
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </ErrorBoundary>
          </div>
        )}
      </div>

      <div className="border-t border-hairline px-5 py-3.5 sm:px-7">
        <form
          onSubmit={submit}
          className="mx-auto flex w-full max-w-[74ch] items-end gap-2 rounded-lg border border-hairline bg-paper px-2.5 py-2 transition-colors focus-within:border-seal/50 focus-within:bg-white"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onChange}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask a question about this data…"
            aria-label="Ask a question"
            className="max-h-[168px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] leading-[22px] text-ink outline-none placeholder:text-ink-muted/80 disabled:opacity-60"
            disabled={isAnalyzing}
          />
          {isAnalyzing ? (
            <Button
              variant="secondary"
              size="icon-sm"
              onClick={stop}
              aria-label="Stop following this answer"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="seal"
              size="icon-sm"
              disabled={!input.trim()}
              aria-label="Send question"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </form>
        <p className="mx-auto mt-1.5 w-full max-w-[74ch] font-mono text-[10px] text-ink-muted">
          Analyses run locally · answers can be wrong, so check the figures that matter
        </p>
      </div>
    </div>
  )
}
