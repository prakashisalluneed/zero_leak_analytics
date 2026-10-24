import { forwardRef } from 'react'
import { LoaderCircle } from 'lucide-react'

const VARIANTS = {
  primary:
    'bg-ink text-paper-raised hover:bg-ink-soft active:bg-ink disabled:bg-ink/60',
  seal:
    'bg-seal text-white hover:bg-seal-bright active:bg-seal disabled:bg-seal/60',
  secondary:
    'border border-hairline bg-paper-raised text-ink hover:border-ink/25 hover:bg-white active:bg-hairline-soft',
  ghost: 'text-ink-soft hover:bg-hairline-soft hover:text-ink active:bg-hairline',
  quiet: 'text-ink-muted hover:text-ink',
  danger: 'bg-alarm text-white hover:bg-alarm/90 active:bg-alarm',
}

const SIZES = {
  xs: 'h-7 gap-1 px-2 text-[12px]',
  sm: 'h-8 gap-1.5 px-2.5 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-[13px]',
  lg: 'h-11 gap-2 px-5 text-[14px]',
  icon: 'h-9 w-9',
  'icon-sm': 'h-8 w-8',
}

const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled = false,
    className = '',
    type = 'button',
    children,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex shrink-0 select-none items-center justify-center rounded-md font-medium',
        'transition-[background-color,border-color,color,box-shadow] duration-150',
        'disabled:pointer-events-none disabled:opacity-60',
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size] ?? SIZES.md,
        className,
      ].join(' ')}
      {...props}
    >
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  )
})

export default Button
