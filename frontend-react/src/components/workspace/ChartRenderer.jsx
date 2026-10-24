import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/* A mineral palette that matches the chrome: one saturated seal tone for the
   primary series, then progressively cooler neutrals. Amber and alarm are never
   used here — those are reserved for limits and errors. */
const SERIES = ['#1f6f5c', '#2c6f92', '#6a5f9e', '#8a6a3f', '#3f7a6a', '#5a6b74']

const AXIS = { fontSize: 11, fill: '#6b7a83', fontFamily: 'IBM Plex Mono, monospace' }
const GRID = '#e8edeb'

/* recharts 3 no longer inherits tick styling from the axis element for
   categorical axes, so each axis supplies an explicit renderer. */
function Tick({ x, y, payload }) {
  const value = String(payload?.value ?? '')
  const label = value.length > 14 ? `${value.slice(0, 13)}…` : value
  // recharts passes the baseline already offset inside the axis band, so no extra
  // dy is applied; the axis height below reserves the room for the label.
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={11}
      fontFamily="IBM Plex Mono, monospace"
      fill="#6b7a83"
    >
      {label}
    </text>
  )
}

const TOOLTIP = {
  contentStyle: {
    borderRadius: 6,
    border: '1px solid #dbe2e0',
    backgroundColor: '#fbfcfb',
    fontSize: 12,
    fontFamily: 'IBM Plex Mono, monospace',
    boxShadow: '0 8px 24px -16px rgba(16,26,32,0.4)',
    padding: '8px 10px',
  },
  labelStyle: { color: '#101a20', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: '#3d4b54' },
  cursor: { fill: 'rgba(16,26,32,0.035)' },
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value)
  }
  return null
}

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/**
 * If every label is a recognisable period, return a comparator for their natural
 * order. Labels are matched against months, quarters, weekdays, and plain years.
 * Returns null when the set is not a period, so arbitrary categories keep the
 * order the computation produced.
 */
function periodOrder(labels) {
  const cleaned = labels.map((label) => String(label).trim().toLowerCase())
  if (cleaned.length === 0) return null

  const indexOf = (collection, value, offset = 0) => {
    const i = collection.indexOf(value)
    return i === -1 ? -1 : i + offset
  }

  // Months: "jan", "january", "jan 2026", "2026-01", "01/2026"
  const monthIndex = (label) => {
    const short = label.slice(0, 3)
    const full = indexOf(MONTH_NAMES, label)
    if (full !== -1) return full
    const isMonth = indexOf(MONTHS, short)
    if (isMonth !== -1 && /^[a-z]{3,}(\s|-|\/|,|$)/.test(label)) return isMonth
    const iso = label.match(/^\d{4}-(\d{1,2})$/)
    if (iso) {
      const n = Number(iso[1]) - 1
      if (n >= 0 && n < 12) return n
    }
    return -1
  }

  if (cleaned.every((label) => monthIndex(label) !== -1)) {
    // Where the year differs, sort by year first.
    const years = cleaned.map((label) => (label.match(/\d{4}/) ?? [])[0])
    const multiYear = new Set(years.filter(Boolean)).size > 1
    return (a, b) => {
      if (multiYear) {
        const ya = (String(a).match(/\d{4}/) ?? ['0'])[0]
        const yb = (String(b).match(/\d{4}/) ?? ['0'])[0]
        if (ya !== yb) return Number(ya) - Number(yb)
      }
      return monthIndex(String(a).trim().toLowerCase()) - monthIndex(String(b).trim().toLowerCase())
    }
  }

  // Quarters: "q1" .. "q4", optionally with a year.
  const quarter = (label) => {
    const m = label.match(/q([1-4])/)
    return m ? Number(m[1]) : -1
  }
  if (cleaned.every((label) => quarter(label) !== -1)) {
    const years = cleaned.map((label) => (label.match(/\d{4}/) ?? [])[0])
    const multiYear = new Set(years.filter(Boolean)).size > 1
    return (a, b) => {
      const la = String(a).trim().toLowerCase()
      const lb = String(b).trim().toLowerCase()
      if (multiYear) {
        const ya = (la.match(/\d{4}/) ?? ['0'])[0]
        const yb = (lb.match(/\d{4}/) ?? ['0'])[0]
        if (ya !== yb) return Number(ya) - Number(yb)
      }
      return quarter(la) - quarter(lb)
    }
  }

  // Weekdays
  const weekday = (label) => indexOf(WEEKDAYS, label.slice(0, 3))
  if (cleaned.every((label) => weekday(label) !== -1)) {
    return (a, b) =>
      weekday(String(a).trim().toLowerCase()) - weekday(String(b).trim().toLowerCase())
  }

  return null
}

function compactValue(value) {
  if (typeof value !== 'number') return value
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value
}

/** Renders whatever shape the backend produced, or throws for the boundary. */
export default function ChartRenderer({ chart }) {
  const type = (chart?.chart_type ?? 'bar').toLowerCase()
  const raw = chart?.chart_data

  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('The chart payload is empty.')
  }

  const keys = Object.keys(raw[0] ?? {})
  const numericKeys = keys.filter((key) => raw.some((row) => toNumber(row[key]) !== null))
  if (numericKeys.length === 0) {
    throw new Error('No numeric columns to plot.')
  }

  const categoryKey = keys.find((key) => !numericKeys.includes(key)) ?? null
  const axisKey = categoryKey ?? 'index'

  const data = raw.map((row, index) => {
    const next = categoryKey ? { ...row } : { index, ...row }
    for (const key of numericKeys) next[key] = toNumber(row[key]) ?? 0
    return next
  })

  // Line and area charts claim an order. When the category looks like a period
  // (Jan..Dec, Q1..Q4, months, years) sort into that order rather than trusting
  // whatever order the groupby emitted; otherwise leave the data as computed.
  if ((type === 'line' || type === 'area') && categoryKey) {
    const order = periodOrder(data.map((row) => String(row[categoryKey])))
    if (order) {
      data.sort((a, b) => order(a[categoryKey]) - order(b[categoryKey]))
    }
  }

  const caption = chart?.title ?? null

  if (type === 'pie') {
    const valueKey = numericKeys[0]
    const nameKey = categoryKey ?? valueKey
    return (
      <figure>
        {caption ? <ChartCaption>{caption}</ChartCaption> : null}
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={nameKey}
              outerRadius={104}
              innerRadius={54}
              paddingAngle={1.5}
              stroke="#fbfcfb"
              strokeWidth={2}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={SERIES[index % SERIES.length]} />
              ))}
            </Pie>
            <Legend
              wrapperStyle={{ fontSize: 11.5, fontFamily: 'IBM Plex Sans, sans-serif' }}
              iconType="circle"
              iconSize={7}
            />
            <Tooltip {...TOOLTIP} />
          </PieChart>
        </ResponsiveContainer>
      </figure>
    )
  }

  if (type === 'scatter' && categoryKey) {
    return (
      <figure>
        {caption ? <ChartCaption>{caption}</ChartCaption> : null}
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis
              type="number"
              dataKey={numericKeys[0]}
              tick={{ ...AXIS }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={compactValue}
            />
            <YAxis
              type="number"
              dataKey={numericKeys[1] ?? numericKeys[0]}
              tick={{ ...AXIS }}
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={compactValue}
            />
            <Tooltip {...TOOLTIP} />
            <Scatter data={data} fill={SERIES[0]} />
          </ScatterChart>
        </ResponsiveContainer>
      </figure>
    )
  }

  const seriesKeys = numericKeys.filter((key) => key !== axisKey)
  const showLegend = seriesKeys.length > 1

  const shared = (
    <>
      <CartesianGrid stroke={GRID} vertical={false} />
      <XAxis
        dataKey={axisKey}
        tick={<Tick />}
        tickLine={false}
        axisLine={{ stroke: GRID }}
        interval="preserveStartEnd"
        minTickGap={16}
        height={34}
      />
      <YAxis
        tick={{ ...AXIS }}
        tickLine={false}
        axisLine={false}
        width={56}
        tickMargin={6}
        tickFormatter={compactValue}
      />
      <Tooltip {...TOOLTIP} />
      {showLegend ? (
        <Legend
          wrapperStyle={{ fontSize: 11.5, fontFamily: 'IBM Plex Sans, sans-serif' }}
          iconType="circle"
          iconSize={7}
        />
      ) : null}
    </>
  )

  // Bottom margin reserves room for the category labels.
  const margin = { top: 8, right: 12, bottom: 4, left: 0 }

  return (
    <figure>
      {caption ? <ChartCaption>{caption}</ChartCaption> : null}
      <ResponsiveContainer width="100%" height={type === 'bar' ? 310 : 290}>
        {type === 'line' ? (
          <LineChart data={data} margin={margin}>
            {shared}
            {seriesKeys.map((key, index) => {
              const color = SERIES[index % SERIES.length]
              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={2}
                  // Dots must carry the series colour: recharts defaults a dot's
                  // fill to white, which with no stroke renders an invisible line.
                  dot={
                    data.length <= 24
                      ? { r: 2.5, fill: color, stroke: '#fbfcfb', strokeWidth: 1 }
                      : false
                  }
                  activeDot={{ r: 4, fill: color, stroke: '#fbfcfb', strokeWidth: 2 }}
                />
              )
            })}
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart data={data} margin={margin}>
            {shared}
            {seriesKeys.map((key, index) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={SERIES[index % SERIES.length]}
                fill={SERIES[index % SERIES.length]}
                fillOpacity={0.12}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart data={data} margin={margin}>
            {shared}
            {seriesKeys.map((key, index) => (
              <Bar
                key={key}
                dataKey={key}
                fill={SERIES[index % SERIES.length]}
                radius={[3, 3, 0, 0]}
                maxBarSize={56}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </figure>
  )
}

function ChartCaption({ children }) {
  return (
    <figcaption className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-muted">
      {children}
    </figcaption>
  )
}
