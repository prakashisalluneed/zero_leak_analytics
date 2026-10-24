import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTaskStatus, startAnalysis } from '../api/sessions'

const POLL_INTERVAL_MS = 650
const MAX_POLL_FAILURES = 4

let idCounter = 0
function nextId() {
  idCounter += 1
  return `m-${Date.now().toString(36)}-${idCounter}`
}

/**
 * Drives one conversation: optimistic user turn, background task dispatch, and
 * polling that renders tokens as they accumulate.
 *
 * Conversation state lives in this hook so switching sessions mounts a fresh one
 * (the caller keys the component on the session id).
 */
export function useChatTask({ sessionId, initialMessages = [], onComplete }) {
  const [messages, setMessages] = useState(initialMessages)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const pollRef = useRef(null)
  const runRef = useRef(0)
  const mountedRef = useRef(true)

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearPoll()
    }
  }, [clearPoll])

  // `initialMessages` seeds state on mount only. The caller keys this hook's
  // component on the session id, so switching conversations remounts rather than
  // needing an in-place reset.

  const stop = useCallback(() => {
    // Stopping only abandons the client's view of the run; the worker finishes and
    // its result is still persisted, so a reload will show the answer.
    runRef.current += 1
    clearPoll()
    setIsAnalyzing(false)
    setMessages((current) =>
      current.map((message) =>
        message.status === 'running'
          ? { ...message, status: 'done', stage: null, stopped: true }
          : message,
      ),
    )
  }, [clearPoll])

  const send = useCallback(
    async (question) => {
      const trimmed = question.trim()
      if (!trimmed || isAnalyzing || !sessionId) return

      const run = (runRef.current += 1)
      const assistantId = nextId()
      const userMessage = {
        id: nextId(),
        role: 'user',
        content: trimmed,
        status: 'done',
        chart: null,
      }

      setMessages((current) => [
        ...current,
        userMessage,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          status: 'running',
          stage: 'pending',
          chart: null,
        },
      ])
      setIsAnalyzing(true)

      const isStale = () => !mountedRef.current || runRef.current !== run

      const update = (patch) => {
        if (isStale()) return
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, ...patch } : message,
          ),
        )
      }

      const finish = (patch) => {
        if (isStale()) return
        update(patch)
        setIsAnalyzing(false)
        onComplete?.()
      }

      let failures = 0

      const poll = async (taskId) => {
        if (isStale()) return
        try {
          const status = await fetchTaskStatus(taskId)
          if (isStale()) return
          failures = 0

          if (status.status === 'SUCCESS') {
            if (status.ok === false) {
              finish({
                status: 'error',
                error: status.error,
                stage: null,
              })
            } else {
              finish({
                status: 'done',
                content: status.answer ?? '',
                chart: status.chart ?? null,
                table: status.table ?? null,
                method: status.method ?? null,
                code: status.code ?? null,
                elapsed_ms: status.elapsed ? Math.round(status.elapsed * 1000) : null,
                truncated: status.truncated ?? false,
                stage: null,
              })
            }
            return
          }

          if (status.status === 'FAILURE' || status.status === 'REVOKED') {
            finish({
              status: 'error',
              error: status.error || 'The analysis failed while running.',
              stage: null,
            })
            return
          }

          update({
            stage: status.stage ?? 'pending',
            content: (status.tokens ?? []).join(''),
            chart: status.chart ?? null,
          })
          pollRef.current = window.setTimeout(() => poll(taskId), POLL_INTERVAL_MS)
        } catch (error) {
          if (isStale()) return
          failures += 1
          if (failures >= MAX_POLL_FAILURES) {
            finish({ status: 'error', error: error.message, stage: null })
            return
          }
          // A transient network blip should not discard a running analysis.
          pollRef.current = window.setTimeout(() => poll(taskId), POLL_INTERVAL_MS * 2)
        }
      }

      try {
        const { task_id: taskId } = await startAnalysis(sessionId, trimmed)
        if (isStale()) return
        poll(taskId)
      } catch (error) {
        finish({ status: 'error', error: error.message, stage: null })
      }
    },
    [sessionId, isAnalyzing, onComplete],
  )

  return { messages, isAnalyzing, send, stop }
}
