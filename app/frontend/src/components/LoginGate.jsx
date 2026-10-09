import { useEffect, useRef, useState } from 'react'
import { login } from '../api'
import logoSymbolWhite from '../brand/logo/neutrinos-symbol-white.png'

/**
 * Password-only login gate. Sits in front of the whole app: it asks the
 * backend whether a session cookie is already valid, and only renders its
 * children once it is. No username — the backend holds a single Argon2id hash.
 */
export default function LoginGate({ children }) {
  const [state, setState] = useState('checking') // checking | anon | authed | error
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/status`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => alive && setState(d.authenticated ? 'authed' : 'anon'))
      .catch(() => alive && setState('anon'))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (state === 'anon') inputRef.current?.focus()
  }, [state])

  async function submit(e) {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError('')
    try {
      await login(password)
      setState('authed')
    } catch (err) {
      setError(err.message || 'Incorrect password')
      setShake(true)
      setPassword('')
      setTimeout(() => setShake(false), 500)
    } finally {
      setBusy(false)
    }
  }

  if (state === 'authed') return children

  if (state === 'checking') {
    return (
      <div className="grid min-h-screen place-items-center bg-midnight">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
      </div>
    )
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-midnight px-4">
      {/* ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 0%, rgba(0,102,255,0.28), transparent 70%), radial-gradient(40% 40% at 85% 90%, rgba(0,102,255,0.16), transparent 70%)',
        }}
      />
      <form
        onSubmit={submit}
        className={`relative w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-8 shadow-2xl backdrop-blur-xl transition-transform ${
          shake ? 'animate-[shake_0.4s]' : ''
        }`}
        style={{ animationName: shake ? 'shake' : undefined }}
      >
        <div className="mb-6 flex items-center gap-3">
          <img src={logoSymbolWhite} alt="" className="h-9 w-9" />
          <div>
            <h1 className="text-lg font-medium text-white">Community Insights</h1>
            <p className="text-xs text-white/50">Neutrinos</p>
          </div>
        </div>

        <label htmlFor="pw" className="mb-2 block text-sm text-white/70">
          Password
        </label>
        <input
          id="pw"
          ref={inputRef}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          className="w-full rounded-lg border border-white/15 bg-black/30 px-4 py-3 text-white outline-none transition focus:border-blue focus:ring-2 focus:ring-blue/40 disabled:opacity-60"
          placeholder="Enter password"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-6 w-full rounded-lg bg-blue px-4 py-3 font-medium text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  )
}
