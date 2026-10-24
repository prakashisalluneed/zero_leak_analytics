import { Link } from 'react-router-dom'
import { ArrowRight, ChartNoAxesColumn, Database, FileSpreadsheet, Lock, Server } from 'lucide-react'
import Button from '../components/ui/Button.jsx'
import { Seal, Wordmark } from '../components/ui/Seal.jsx'

/* ---------------------------------------------------------------------------
   The hero's structural device: a boundary diagram showing where inference
   happens. It is the product's actual architecture, drawn to scale — not an
   illustration. Everything else on the page stays quiet around it.
--------------------------------------------------------------------------- */

function BoundaryDiagram() {
  return (
    <figure className="relative">
      <div className="rounded-lg border border-hairline bg-paper-raised p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-muted">
            Request path
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-seal">
            <Lock className="h-3 w-3" />
            Sealed
          </span>
        </div>

        <div className="space-y-2.5">
          <Node
            icon={FileSpreadsheet}
            label="Your spreadsheet"
            detail="CSV or XLSX"
            tone="data"
          />
          <Flow label="schema only" />
          <Node
            icon={Database}
            label="Analysis runs on your machine"
            detail="Django · Postgres · Pandas"
            tone="sealed"
          />
          <Flow label="code, never rows" />
          <Node
            icon={Server}
            label="Local model"
            detail="Ollama · llama3.1 · 127.0.0.1"
            tone="sealed"
          />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-md border border-hairline bg-paper px-3 py-2.5">
          <Lock className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-muted" />
          <p className="text-[12px] leading-[18px] text-ink-soft">
            The boundary closes here. No request leaves this host, so there is no
            outbound traffic to audit and no vendor to trust.
          </p>
        </div>
      </div>

      {/* The seal itself, set once, large, and partly behind the panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-8 -z-10 hidden text-seal/20 sm:block"
      >
        <Seal size={132} strokeWidth={1} />
      </div>
    </figure>
  )
}

function Node({ icon: Icon, label, detail, tone }) {
  const sealed = tone === 'sealed'
  return (
    <div
      className={[
        'flex items-center gap-3 rounded-md border px-3 py-2.5',
        sealed ? 'border-seal/25 bg-seal-wash/60' : 'border-hairline bg-paper',
      ].join(' ')}
    >
      <span
        className={[
          'flex h-7 w-7 shrink-0 items-center justify-center rounded',
          sealed ? 'bg-seal/10 text-seal' : 'bg-paper-raised text-ink-muted',
        ].join(' ')}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-ink">{label}</p>
        <p className="truncate font-mono text-[11px] text-ink-muted">{detail}</p>
      </div>
    </div>
  )
}

function Flow({ label }) {
  return (
    <div className="flex items-center gap-2 pl-[38px]">
      <span className="h-3 w-px bg-hairline" />
      <span className="font-mono text-[10.5px] text-ink-muted">{label}</span>
    </div>
  )
}

function Capability({ icon: Icon, title, children }) {
  return (
    <div className="border-t border-hairline pt-5">
      <Icon className="h-4 w-4 text-seal" />
      <h3 className="mt-3 text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-[13.5px] leading-[21px] text-ink-soft text-pretty">{children}</p>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-full bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Wordmark />
        <nav className="flex items-center gap-1.5">
          <Link to="/signin">
            <Button variant="quiet" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/signup">
            <Button size="sm">Create an account</Button>
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
        {/* Hero */}
        <section className="grid items-center gap-10 pb-16 pt-8 sm:pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div className="rise">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-hairline bg-paper-raised px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-seal" />
              Runs on your infrastructure
            </p>

            <h1 className="font-serif text-[34px] leading-[1.12] tracking-[-0.015em] text-ink sm:text-[46px] sm:leading-[1.08] text-balance">
              Ask your data anything. It never has to leave the building.
            </h1>

            <p className="mt-5 max-w-[52ch] text-[15.5px] leading-[25px] text-ink-soft text-pretty">
              Zero Leak is an analyst that reads your spreadsheets and answers in plain
              language, with charts. The model runs locally, the files stay on your disk,
              and every query is computed in a sandbox rather than described by a vendor.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Link to="/signup">
                <Button size="lg" variant="seal">
                  Start analysing
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/signin">
                <Button size="lg" variant="secondary">
                  I already have an account
                </Button>
              </Link>
            </div>

            <dl className="mt-9 flex flex-wrap gap-x-8 gap-y-3 border-t border-hairline pt-5">
              <div>
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-muted">
                  Outbound data
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-ink">None</dd>
              </div>
              <div>
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-muted">
                  Retention
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-ink">Your disk only</dd>
              </div>
              <div>
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-muted">
                  Code execution
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium text-ink">Sandboxed</dd>
              </div>
            </dl>
          </div>

          <div className="rise" style={{ animationDelay: '90ms' }}>
            <BoundaryDiagram />
          </div>
        </section>

        {/* Capabilities */}
        <section className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          <Capability icon={ChartNoAxesColumn} title="Answers you can check">
            Every response is computed by running code against your actual rows, then
            written up in a sentence or two. Charts are drawn from the computed result,
            so the picture and the number agree.
          </Capability>
          <Capability icon={Lock} title="A real boundary, not a promise">
            The model receives column names and types only. Values are never sent to it.
            Generated code is parsed and checked against a syntax allowlist before it
            runs, which closes the escapes a keyword blocklist misses.
          </Capability>
          <Capability icon={Database} title="A workspace, not a chat box">
            Uploads are profiled on arrival. Conversations are saved against the dataset
            they belong to, so a question asked on Monday is still there on Friday with
            its charts intact.
          </Capability>
        </section>

        {/* Closing */}
        <section className="mt-16 border-t border-hairline pt-10">
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="font-serif text-[24px] leading-tight tracking-[-0.01em] text-ink">
                Bring a spreadsheet. See what it has been hiding.
              </h2>
              <p className="mt-1.5 text-[13.5px] text-ink-soft">
                Free to start. No card, and nothing to install beyond the model you
                already run.
              </p>
            </div>
            <Link to="/signup" className="shrink-0">
              <Button size="lg">Create an account</Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-[12px] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span className="font-mono text-[11px]">Zero Leak Analytics</span>
          <span>Local model · Sandboxed execution · No outbound data</span>
        </div>
      </footer>
    </div>
  )
}
