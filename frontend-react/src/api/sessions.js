import { apiJson, apiSend, toApiError, apiFetch } from './client'

export async function fetchSessions({ datasetId, pinned } = {}) {
  const params = new URLSearchParams()
  if (datasetId) params.set('dataset', datasetId)
  if (pinned) params.set('pinned', '1')
  const query = params.toString()
  const data = await apiJson(`/api/sessions/${query ? `?${query}` : ''}`)
  return data.sessions ?? []
}

export async function fetchSession(id) {
  const data = await apiJson(`/api/sessions/${id}/`)
  return data.session
}

export async function createSession(datasetId, title) {
  const data = await apiSend('/api/sessions/', 'POST', { dataset_id: datasetId, title })
  return data.session
}

export async function updateSession(id, patch) {
  return apiSend(`/api/sessions/${id}/`, 'PATCH', patch)
}

export async function deleteSession(id) {
  return apiSend(`/api/sessions/${id}/`, 'DELETE')
}

// Dispatch the analysis to the worker and get a task id back immediately.
export async function startAnalysis(sessionId, question) {
  const response = await apiFetch(`/api/sessions/${sessionId}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!response.ok) throw await toApiError(response)
  return response.json()
}

export async function fetchTaskStatus(taskId) {
  const response = await apiFetch(`/api/tasks/${taskId}/`)
  if (!response.ok) throw await toApiError(response)
  return response.json()
}
