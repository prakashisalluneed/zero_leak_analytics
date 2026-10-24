import { Link } from 'react-router-dom'
import { Seal } from './ui/Seal.jsx'

/**
 * Two-column auth frame: the form on the left, and a quiet statement of the
 * product's one claim on the right. On small screens the right column collapses
 * to a thin footer line.
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-full bg-paper lg:grid-cols-[1fr_0.85fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10 sm:py-8">
        <Link to="/" className="inline-flex w-fit items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-paper-raised">
            <Seal size={20} strokeWidth={1.7} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">
              Zero Leak
            </span>
            <span className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-muted">
              Analytics
            </span>
          </span>
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px]">
            <h1 className="font-serif text-[26px] leading-tight tracking-[-0.01em] text-ink">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1.5 text-[13.5px] leading-5 text-ink-soft">{subtitle}</p>
            ) : null}

            <div className="mt-7">{children}</div>

            {footer ? <div className="mt-6 text-[13px] text-ink-soft">{footer}</div> : null}
          </div>
        </div>
      </div>

      {/* Right rail: the boundary statement, at a glance. */}
      <aside className="hidden border-l border-hairline bg-paper-raised lg:flex lg:flex-col lg:justify-center lg:px-12">
        <div className="max-w-[38ch]">
          <Seal size={54} strokeWidth={1.1} className="text-seal" />
          <p className="mt-6 font-serif text-[19px] leading-[29px] text-ink text-pretty">
            Your spreadsheet is read on this machine. The model that writes the analysis
            runs here too, and the code it produces is checked before it executes.
          </p>
          <ul className="mt-6 space-y-2.5 text-[13px] text-ink-soft">
            {[
              'No prompts sent to a third-party API',
              'Files stored on your own disk',
              'Every answer computed, not described',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-seal" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  )
}
