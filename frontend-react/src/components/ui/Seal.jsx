/**
 * The product mark. A boundary ring with a contained core: the one graphic device
 * the interface uses, and it appears at a single size in the chrome.
 */
export function Seal({ size = 26, className = '', strokeWidth = 1.6 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="16" cy="16" r="14.2" stroke="currentColor" strokeOpacity="0.3" strokeWidth={strokeWidth} />
      <circle cx="16" cy="16" r="9" stroke="currentColor" strokeOpacity="0.55" strokeWidth={strokeWidth} />
      <circle cx="16" cy="16" r="4" fill="currentColor" />
    </svg>
  )
}

export function Wordmark({ compact = false }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-paper-raised">
        <Seal size={20} strokeWidth={1.7} />
      </span>
      {compact ? null : (
        <span className="flex flex-col leading-none">
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-ink">Zero Leak</span>
          <span className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-muted">
            Analytics
          </span>
        </span>
      )}
    </span>
  )
}

export default Seal
