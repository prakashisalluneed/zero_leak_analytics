import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, ShieldCheck } from 'lucide-react'
import Button from '../components/ui/Button.jsx'
import Field from '../components/ui/Field.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from '../contexts/ToastContext.jsx'
import { apiJson, apiSend } from '../api/client'
import { formatDate } from '../lib/format'

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'security', label: 'Password' },
  { id: 'plan', label: 'Plan' },
  { id: 'privacy', label: 'Data & privacy' },
]

function Section({ id, title, description, children }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-hairline pt-7">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-ink-soft">{description}</p>
      ) : null}
      <div className="mt-4 max-w-[440px]">{children}</div>
    </section>
  )
}

export default function SettingsPage() {
  const { user, updateUser, logout, tier } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [profile, setProfile] = useState({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    email: user?.email ?? '',
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState(null)

  const [passwords, setPasswords] = useState({ current_password: '', new_password: '' })
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState(null)
  const [passwordDone, setPasswordDone] = useState(false)

  const [preferences, setPreferences] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiJson('/api/preferences/')
      .then((data) => {
        if (!cancelled) setPreferences(data.preferences ?? {})
      })
      .catch(() => {
        if (!cancelled) setPreferences({})
      })
    return () => {
      cancelled = true
    }
  }, [])

  const saveProfile = async (event) => {
    event.preventDefault()
    if (savingProfile) return
    setSavingProfile(true)
    setProfileError(null)
    try {
      await updateUser({
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
      })
      toast.success('Profile saved')
    } catch (err) {
      setProfileError(err.message)
    } finally {
      setSavingProfile(false)
    }
  }

  const savePassword = async (event) => {
    event.preventDefault()
    if (savingPassword) return
    setSavingPassword(true)
    setPasswordError(null)
    setPasswordDone(false)
    try {
      await apiSend('/api/auth/password/', 'POST', passwords)
      setPasswords({ current_password: '', new_password: '' })
      setPasswordDone(true)
      toast.success('Password changed')
    } catch (err) {
      setPasswordError(err.message)
    } finally {
      setSavingPassword(false)
    }
  }

  const togglePreference = async (key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }))
    try {
      await apiSend('/api/preferences/', 'PUT', { [key]: value })
    } catch (err) {
      setPreferences((current) => ({ ...current, [key]: !value }))
      toast.error('Could not save that preference', err.message)
    }
  }

  const signOut = () => {
    logout()
    navigate('/signin', { replace: true })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-10">
        <header>
          <h1 className="font-serif text-[26px] leading-tight tracking-[-0.01em] text-ink">
            Settings
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Signed in as {user?.display_name ?? '—'} since {formatDate(user?.date_joined)}.
          </p>
        </header>

        <div className="mt-8 grid gap-9 lg:grid-cols-[150px_1fr] lg:gap-10">
          <nav aria-label="Settings sections" className="hidden lg:block">
            <ul className="sticky top-0 space-y-0.5">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block rounded px-2 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:bg-hairline-soft hover:text-ink"
                  >
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-8">
            <Section
              id="profile"
              title="Profile"
              description="How your name appears in the workspace. Your username cannot change."
            >
              <form onSubmit={saveProfile} className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <Field
                    label="First name"
                    value={profile.first_name}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, first_name: event.target.value }))
                    }
                  />
                  <Field
                    label="Last name"
                    value={profile.last_name}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, last_name: event.target.value }))
                    }
                  />
                </div>
                <Field
                  label="Username"
                  value={user?.username ?? ''}
                  disabled
                  hint="Fixed"
                />
                <Field
                  label="Email"
                  type="email"
                  value={profile.email}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, email: event.target.value }))
                  }
                  error={profileError}
                />
                <Button type="submit" loading={savingProfile}>
                  Save profile
                </Button>
              </form>
            </Section>

            <Section
              id="security"
              title="Password"
              description="Use at least eight characters. The server also rejects common and entirely numeric passwords."
            >
              <form onSubmit={savePassword} className="space-y-3.5">
                <Field
                  label="Current password"
                  type="password"
                  autoComplete="current-password"
                  value={passwords.current_password}
                  onChange={(event) =>
                    setPasswords((current) => ({ ...current, current_password: event.target.value }))
                  }
                  required
                />
                <Field
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  value={passwords.new_password}
                  onChange={(event) =>
                    setPasswords((current) => ({ ...current, new_password: event.target.value }))
                  }
                  error={passwordError}
                  required
                />
                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    loading={savingPassword}
                    disabled={!passwords.current_password || !passwords.new_password}
                  >
                    Change password
                  </Button>
                  {passwordDone ? (
                    <span className="flex items-center gap-1.5 text-[12.5px] text-seal">
                      <Check className="h-3.5 w-3.5" />
                      Updated
                    </span>
                  ) : null}
                </div>
              </form>
            </Section>

            <Section
              id="plan"
              title="Plan"
              description="Free includes five analyses a minute. Pro raises that to fifty."
            >
              <div className="rounded-md border border-hairline bg-paper-raised p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-medium capitalize text-ink">{tier} plan</p>
                    <p className="mt-0.5 font-mono text-[10.5px] text-ink-muted">
                      {tier === 'pro' ? '50 analyses per minute' : '5 analyses per minute'}
                    </p>
                  </div>
                  {tier !== 'pro' ? (
                    <Button
                      variant="seal"
                      size="sm"
                      onClick={() => toast.info('Billing is not connected yet', 'Set STRIPE_PRICE_ID to enable checkout.')}
                    >
                      Upgrade
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </Section>

            <Section
              id="privacy"
              title="Data and privacy"
              description="These settings describe what the analyser is allowed to do with a file."
            >
              <div className="space-y-3">
                <label className="flex cursor-pointer items-start gap-3 rounded-md border border-hairline bg-paper-raised p-3.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-hairline accent-[#1f6f5c]"
                    checked={preferences?.show_sample_values !== false}
                    onChange={(event) => togglePreference('show_sample_values', event.target.checked)}
                    disabled={!preferences}
                  />
                  <span>
                    <span className="block text-[13px] font-medium text-ink">
                      Include sample values in the preview
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-5 text-ink-soft">
                      Sample values are shown to you in the data panel. They are never sent
                      to the model.
                    </span>
                  </span>
                </label>

                <div className="flex items-start gap-3 rounded-md border border-seal/25 bg-seal-wash/60 p-3.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-seal" />
                  <div>
                    <p className="text-[13px] font-medium text-ink">Nothing leaves this host</p>
                    <p className="mt-0.5 text-[12.5px] leading-5 text-ink-soft">
                      Inference runs against the local model server. Uploaded files stay on
                      this machine's disk and are deleted when you remove the dataset.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-paper-raised p-3.5">
                  <div>
                    <p className="text-[13px] font-medium text-ink">Sign out</p>
                    <p className="mt-0.5 text-[12.5px] text-ink-soft">
                      Ends this session on this device.
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={signOut}>
                    Sign out
                  </Button>
                </div>
              </div>
            </Section>
          </div>
        </div>
      </div>
    </div>
  )
}
