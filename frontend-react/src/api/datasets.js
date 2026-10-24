import { apiJson, apiSend, apiFetch, toApiError } from './client'

export async function fetchDatasets() {
  const data = await apiJson('/api/datasets/')
  return data.datasets ?? []
}

export async function uploadDataset(file) {
  const form = new FormData()
  form.append('file', file)

  const response = await apiFetch('/api/datasets/', { method: 'POST', body: form })
  if (!response.ok) throw await toApiError(response)
  return response.json()
}

export async function fetchDataset(id) {
  const data = await apiJson(`/api/datasets/${id}/`)
  return data.dataset
}

export async function fetchPreview(id, rows = 25) {
  return apiJson(`/api/datasets/${id}/preview/?rows=${rows}`)
}

export async function updateDataset(id, patch) {
  const data = await apiSend(`/api/datasets/${id}/`, 'PATCH', patch)
  return data.dataset
}

export async function deleteDataset(id) {
  return apiSend(`/api/datasets/${id}/`, 'DELETE')
}

export async function fetchStats() {
  return apiJson('/api/stats/')
}
