import { forwardRef, useId } from 'react'
import { CircleAlert } from 'lucide-react'

/**
 * A labelled input with inline validation. Kept deliberately plain: a rule-line
 * field that reads as part of a form, not a decorative box.
 */
const Field = forwardRef(function Field(
  { label, hint, error, className = '', as: Tag = 'input', children, ...props },
  ref,
) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const invalid = Boolean(error)

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {hint ? (
          <span id={`${id}-hint`} className="text-[12px] text-ink-muted">
            {hint}
          </span>
        ) : null}
      </div>

      <Tag
        ref={ref}
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={[
          'block w-full rounded-md border bg-paper-raised px-3 text-[14px] text-ink',
          'transition-colors placeholder:text-ink-muted/70',
          'focus:outline-none focus:ring-0',
          invalid
            ? 'border-alarm focus:border-alarm'
            : 'border-hairline hover:border-ink/20 focus:border-seal',
          Tag === 'textarea' ? 'min-h-[88px] resize-y py-2 leading-6' : 'h-10',
        ].join(' ')}
        {...props}
      >
        {children}
      </Tag>

      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-alarm">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
})

export default Field
