import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { fetchDatasets, deleteDataset, updateDataset } from '../api/datasets'
import { fetchSessions } from '../api/sessions'

const WorkspaceContext = createContext(null)

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return context
}

/**
 * One source of truth for the sidebar: datasets, conversations, and the refresh
 * triggers that keep them consistent after an upload or a completed analysis.
 */
export function WorkspaceProvider({ children }) {
  const [datasets, setDatasets] = useState([])
  const [sessions, setSessions] = useState([])
  const [loadingDatasets, setLoadingDatasets] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)

  // Loaders stay free of synchronous state writes so they can be called from an
  // effect without cascading renders: the "loading" flag is flipped inside the
  // promise callbacks, not before the request is issued.
  const reloadDatasets = useCallback(() => {
    return fetchDatasets()
      .then((rows) => {
        setDatasets(rows)
        setError(null)
        setLoadingDatasets(false)
        return rows
      })
      .catch((err) => {
        setError(err.message)
        setLoadingDatasets(false)
        return []
      })
  }, [])

  const reloadSessions = useCallback(() => {
    return fetchSessions()
      .then((rows) => {
        setSessions(rows)
        setLoadingSessions(false)
        return rows
      })
      .catch(() => {
        setLoadingSessions(false)
        return []
      })
  }, [])

  useEffect(() => {
    reloadDatasets()
    reloadSessions()
  }, [reloadDatasets, reloadSessions, revision])

  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  const toggleStar = useCallback(async (dataset) => {
    // Optimistic: the sidebar should respond to the click, not the round trip.
    setDatasets((current) =>
      current.map((row) =>
        row.id === dataset.id ? { ...row, is_starred: !row.is_starred } : row,
      ),
    )
    try {
      await updateDataset(dataset.id, { is_starred: !dataset.is_starred })
    } catch {
      setDatasets((current) =>
        current.map((row) =>
          row.id === dataset.id ? { ...row, is_starred: dataset.is_starred } : row,
        ),
      )
    }
  }, [])

  const removeDataset = useCallback(
    async (datasetId) => {
      await deleteDataset(datasetId)
      setDatasets((current) => current.filter((row) => row.id !== datasetId))
      setSessions((current) => current.filter((row) => row.dataset_id !== datasetId))
    },
    [],
  )

  const value = useMemo(
    () => ({
      datasets,
      sessions,
      loading: loadingDatasets || loadingSessions,
      loadingDatasets,
      loadingSessions,
      error,
      refresh,
      reloadDatasets,
      reloadSessions,
      toggleStar,
      removeDataset,
    }),
    [
      datasets,
      sessions,
      loadingDatasets,
      loadingSessions,
      error,
      refresh,
      reloadDatasets,
      reloadSessions,
      toggleStar,
      removeDataset,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
