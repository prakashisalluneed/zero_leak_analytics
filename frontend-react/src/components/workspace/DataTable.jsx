import { formatNumber } from '../../lib/format'

/** A compact, scrollable table for tabular results returned by an analysis. */
export default function DataTable({ table, maxHeight = 380 }) {
  const columns = table?.columns ?? []
  const rows = table?.rows ?? []
  if (columns.length === 0) return null

  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-paper-raised">
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-paper">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="whitespace-nowrap border-b border-hairline px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-muted"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="even:bg-paper/40">
                {columns.map((column) => {
                  const value = row[column]
                  const numeric = typeof value === 'number'
                  return (
                    <td
                      key={column}
                      className={[
                        'whitespace-nowrap border-b border-hairline-soft px-3 py-1.5 text-[12.5px] text-ink-soft',
                        numeric ? 'text-right font-mono tabular-nums' : '',
                      ].join(' ')}
                    >
                      {value === null || value === undefined || value === '' ? (
                        <span className="text-ink-muted">—</span>
                      ) : numeric ? (
                        formatNumber(value)
                      ) : (
                        String(value)
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 50 ? (
        <p className="border-t border-hairline bg-paper px-3 py-1.5 text-[11px] text-ink-muted">
          Showing the first 50 rows.
        </p>
      ) : null}
    </div>
  )
}
