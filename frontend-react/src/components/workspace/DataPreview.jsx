import { useEffect, useState } from 'react'
import { ChevronDown, Columns3, X } from 'lucide-react'
import Button from '../ui/Button.jsx'
import { Skeleton } from '../ui/Feedback.jsx'
import { fetchPreview } from '../../api/datasets'
import { describeDataset, formatBytes, formatNumber } from '../../lib/format.js'

/**
 * The dataset's shape: column profile first, then a sample of rows. Deliberately
 * narrow — it sits beside the conversation rather than competing with it.
 */
export default function DataPreview({ dataset, onClose }) {
  // The loaded payload is tagged with the dataset it belongs to, so a change of
  // dataset reads as "not loaded yet" during render instead of needing a
  // synchronous reset inside the effect.
  const [loaded, setLoaded] = useState(null)
  const [showRows, setShowRows] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchPreview(dataset.id, 20)
      .then((payload) => {
        if (!cancelled) setLoaded({ id: dataset.id, payload, error: null })
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ id: dataset.id, payload: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [dataset.id])

  const current = loaded?.id === dataset.id ? loaded : null
  const data = current?.payload ?? null
  const error = current?.error ?? null
  const columns = data?.columns ?? []
  const preview = data?.preview

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            Dataset
          </p>
          <p className="mt-0.5 truncate text-[13px] font-medium text-ink">{dataset.name}</p>
        </div>
        {onClose ? (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close data panel">
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-b border-hairline px-4 py-3.5">
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-muted">
              Rows
            </dt>
            <dd className="mt-0.5 font-mono text-[13px] text-ink tabular-nums">
              {formatNumber(dataset.row_count)}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-muted">
              Columns
            </dt>
            <dd className="mt-0.5 font-mono text-[13px] text-ink tabular-nums">
              {formatNumber(dataset.column_count)}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-muted">
              Size
            </dt>
            <dd className="mt-0.5 font-mono text-[13px] text-ink tabular-nums">
              {formatBytes(dataset.size_bytes)}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-muted">
              Type
            </dt>
            <dd className="mt-0.5 font-mono text-[12px] text-ink">
              {dataset.name?.toLowerCase().endsWith('.xlsx') ? 'XLSX' : 'CSV'}
            </dd>
          </div>
        </dl>

        {dataset.truncated ? (
          <p className="border-b border-limit/20 bg-limit-wash px-4 py-2 text-[11.5px] leading-[17px] text-limit">
            Only the first 200,000 rows are analysed.
          </p>
        ) : null}

        <section className="px-4 py-3.5">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
            Columns
          </h2>

          {error ? (
            <p className="rounded border border-alarm/25 bg-alarm-wash px-2.5 py-2 text-[11.5px] text-alarm">
              {error}
            </p>
          ) : !data ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-7 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {columns.map((column) => (
                <li key={column.name} className="flex items-start gap-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-ink">{column.name}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-muted">
                      {column.dtype}
                      {column.null_count > 0 ? ` · ${formatNumber(column.null_count)} empty` : ''}
                    </span>
                  </span>
                  {column.unique_count !== null && column.unique_count !== undefined ? (
                    <span
                      className="shrink-0 font-mono text-[10px] text-ink-muted tabular-nums"
                      title={`${column.unique_count} distinct values`}
                    >
                      {formatNumber(column.unique_count)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {preview ? (
          <section className="border-t border-hairline px-4 py-3">
            <button
              type="button"
              onClick={() => setShowRows((value) => !value)}
              aria-expanded={showRows}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                <Columns3 className="h-3 w-3" />
                Sample rows
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-ink-muted transition-transform ${showRows ? 'rotate-180' : ''}`}
              />
            </button>

            {showRows ? (
              <div className="mt-2.5 max-h-[280px] overflow-auto rounded border border-hairline">
                <table className="w-full border-collapse text-left">
                  <thead className="sticky top-0 bg-paper">
                    <tr>
                      {preview.columns.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="whitespace-nowrap border-b border-hairline px-2 py-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-muted"
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={index}>
                        {preview.columns.map((column) => (
                          <td
                            key={column}
                            className="max-w-[140px] truncate whitespace-nowrap border-b border-hairline-soft px-2 py-1 font-mono text-[10.5px] text-ink-soft"
                          >
                            {row[column] === null || row[column] === '' ? (
                              <span className="text-ink-muted">—</span>
                            ) : (
                              String(row[column])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        <p className="border-t border-hairline px-4 py-3 font-mono text-[10px] leading-[16px] text-ink-muted">
          {describeDataset(dataset)} · stored on this machine
        </p>
      </div>
    </div>
  )
}
