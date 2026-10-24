import { Seal } from './ui/Seal.jsx'

export default function AppBoot() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-paper">
      <div className="fade flex flex-col items-center gap-3">
        <span className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-md bg-ink text-paper-raised">
          <Seal size={26} strokeWidth={1.7} />
        </span>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
          Opening workspace
        </p>
      </div>
    </div>
  )
}
