import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, LoaderCircle } from 'lucide-react'
import AuthLayout from '../components/AuthLayout.jsx'
import Button from '../components/ui/Button.jsx'
import Field from '../components/ui/Field.jsx'
import { checkUsername } from '../api/auth'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from '../contexts/ToastContext.jsx'

const MIN_PASSWORD = 8

/** Strength is advisory; the server is the authority (Django's validators). */
function passwordChecks(password) {
  return [
    { label: `${MIN_PASSWORD}+ characters`, met: password.length >= MIN_PASSWORD },
    { label: 'A number', met: /\d/.test(password) },
    { label: 'Not a common password', met: password.length > 0 && !/^(password|12345678|qwerty)/i.test(password) },
  ]
}

export default function SignUpPage() {
  const { register } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: '',
  })
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const usernameTimer = useRef(null)

  const set = (key) => (event) => {
    const value = event.target.value
    setForm((current) => ({ ...current, [key]: value }))
    if (fieldErrors[key]) setFieldErrors((current) => ({ ...current, [key]: undefined }))
  }

  // Debounced availability check so the field reports a conflict before submit.
  // The "checking" state is derived during render; the timer only writes the
  // settled result.
  const username = form.username.trim()
  const checkable = username.length >= 3
  const [settled, setSettled] = useState({ username: '', status: 'idle', reason: '' })

  useEffect(() => {
    if (!checkable) return undefined

    window.clearTimeout(usernameTimer.current)
    usernameTimer.current = window.setTimeout(async () => {
      try {
        const result = await checkUsername(username)
        setSettled({
          username,
          status: result.available ? 'available' : 'taken',
          reason: result.reason,
        })
      } catch {
        setSettled({ username, status: 'idle', reason: '' })
      }
    }, 420)

    return () => window.clearTimeout(usernameTimer.current)
  }, [username, checkable])

  // Derived status: pending while a check for the current value has not settled.
  const usernameState = !checkable
    ? { status: 'idle', reason: '' }
    : settled.username === username
      ? settled
      : { status: 'checking', reason: '' }

  const checks = passwordChecks(form.password)
  const canSubmit =
    form.username.trim() &&
    form.email.trim() &&
    checks[0].met &&
    !submitting

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return

    setFormError(null)
    setFieldErrors({})
    setSubmitting(true)
    try {
      await register({
        username: form.username.trim(),
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
      })
      toast.success('Account created', 'Upload a spreadsheet to get started.')
      navigate('/app', { replace: true })
    } catch (err) {
      if (err.fields) setFieldErrors(err.fields)
      else setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Analyses run locally; this account only keeps them organised."
      footer={
        <>
          Already registered?{' '}
          <Link to="/signin" className="font-medium text-seal underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="First name"
            value={form.firstName}
            onChange={set('firstName')}
            autoComplete="given-name"
            error={fieldErrors.name}
          />
          <Field
            label="Last name"
            value={form.lastName}
            onChange={set('lastName')}
            autoComplete="family-name"
          />
        </div>

        <Field
          label="Username"
          value={form.username}
          onChange={set('username')}
          autoComplete="username"
          required
          error={fieldErrors.username}
          hint={
            usernameState.status === 'checking' ? (
              <span className="inline-flex items-center gap-1">
                <LoaderCircle className="h-3 w-3 animate-spin" />
                Checking
              </span>
            ) : usernameState.status === 'available' ? (
              <span className="inline-flex items-center gap-1 text-seal">
                <Check className="h-3 w-3" />
                Available
              </span>
            ) : usernameState.status === 'taken' ? (
              <span className="text-alarm">Taken</span>
            ) : null
          }
        />

        <Field
          label="Email"
          type="email"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
          required
          error={fieldErrors.email}
        />

        <div>
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={set('password')}
            autoComplete="new-password"
            required
            error={fieldErrors.password}
          />
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1">
            {checks.map((check) => (
              <li
                key={check.label}
                className={`flex items-center gap-1 text-[11.5px] ${
                  check.met ? 'text-seal' : 'text-ink-muted'
                }`}
              >
                <Check
                  className={`h-3 w-3 ${check.met ? 'opacity-100' : 'opacity-30'}`}
                  strokeWidth={2.5}
                />
                {check.label}
              </li>
            ))}
          </ul>
        </div>

        {formError ? (
          <p className="rounded-md border border-alarm/25 bg-alarm-wash px-3 py-2 text-[12.5px] text-alarm">
            {formError}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="seal"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={!canSubmit}
        >
          Create account
        </Button>

        <p className="text-[11.5px] leading-[18px] text-ink-muted">
          Your files are stored on this machine and are never uploaded to a third party.
        </p>
      </form>
    </AuthLayout>
  )
}
