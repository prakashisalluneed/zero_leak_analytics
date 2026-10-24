/** Number, size, and date formatting shared across the workspace. */

const numberFormat = new Intl.NumberFormat('en-US')
const compactFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return numberFormat.format(value)
}

export function formatCompact(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (Math.abs(value) < 1000) return numberFormat.format(value)
  return compactFormat.format(value)
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`
}

export function formatRelative(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 90) return 'a minute ago'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
  if (seconds < 604800) return `${Math.round(seconds / 86400)} d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDate(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** "1,204 rows · 12 columns" — the standard dataset summary line. */
export function describeDataset(dataset) {
  const rows = formatNumber(dataset?.row_count ?? 0)
  const cols = formatNumber(dataset?.column_count ?? 0)
  return `${rows} ${dataset?.row_count === 1 ? 'row' : 'rows'} · ${cols} ${dataset?.column_count === 1 ? 'column' : 'columns'}`
}

export function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
