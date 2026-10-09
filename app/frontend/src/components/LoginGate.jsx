import { useCallback, useEffect, useRef, useState } from 'react'
import { login, logout as apiLogout } from '../api'
import { useIdleLogout } from '../auth'
import logoSymbolWhite from '../brand/logo/neutrinos-symbol-white.png'
import logoHorizontalWhite from '../brand/logo/neutrinos-horizontal-white-tagline.png'
import shotLaptop from '../marketing/shot-laptop.png'
import shotPhone from '../marketing/shot-phone.png'

/**
 * Password-only login gate, twin-column, fixed to the viewport (no scroll).
 *
 * Left (lg+): Midnight Blue brand panel — headline, a 16:9 dashboard shot in a
 * laptop frame, a 9:16 shot in a phone frame, and proof stats. Every size is
 * relative to the viewport height so the page never scrolls.
 * Below lg: the marketing panel is dropped entirely and the card centres, so
 * mobile is a clean single column.
 *
 * Auth behaviour is unchanged: it asks the backend whether a session cookie is
 * valid, renders its children once it is, and runs the idle auto-logoff timer.
 */

const STATS = [
  { value: '5,067', label: 'posts analysed' },
  { value: '1,238', label: 'topics tracked' },
  { value: '95%', label: 'model confidence' },
]

export default function LoginGate({ children }) {
  const [state, setState] = useState('checking') // checking | anon | authed | error
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [idleMinutes, setIdleMinutes] = useState(30)
  const inputRef = useRef(null)

  const doLogout = useCallback(async () => {
    try {
      await apiLogout()
    } catch {
      /* drop the local session regardless */
    }
    setState('anon')
  }, [])

  const { warning, staySignedIn } = useIdleLogout({
    enabled: state === 'authed',
    idleMinutes,
    onLogout: doLogout,
  })

  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/auth/status`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        if (d.idle_minutes) setIdleMinutes(d.idle_minutes)
        setState(d.authenticated ? 'authed' : 'anon')
      })
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

  if (state === 'authed') {
    return (
      <>
        {warning !== null && (
          <div className="fixed inset-0 z-[100] grid place-items-center bg-midnight/60 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white p-6 shadow-2xl">
              <h2 className="text-lg font-medium text-black">Still there?</h2>
              <p className="mt-1 text-sm text-muted">
                For your security you'll be signed out in{' '}
                <span className="font-medium tabular-nums text-black">{warning}s</span> unless you
                keep working.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={doLogout}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:bg-gray-50"
                >
                  Sign out now
                </button>
                <button
                  type="button"
                  onClick={staySignedIn}
                  className="rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white hover:brightness-110"
                >
                  Stay signed in
                </button>
              </div>
            </div>
          </div>
        )}
        {children}
      </>
    )
  }

  if (state === 'checking') {
    return (
      <div className="grid h-[100dvh] place-items-center bg-midnight">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
      </div>
    )
  }

  return (
    <div className="grid h-[100dvh] overflow-hidden lg:grid-cols-[2fr_1fr]">
      {/* ---------- Left: brand + product preview (lg+) ---------- */}
      <aside className="neu-login-panel relative hidden h-[100dvh] flex-col overflow-hidden bg-midnight px-12 py-9 lg:flex xl:px-16">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="neu-orb neu-orb--a" />
          <div className="neu-orb neu-orb--b" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(70% 55% at 15% 0%, rgba(0,102,255,0.30), transparent 65%), radial-gradient(45% 45% at 100% 100%, rgba(77,148,255,0.14), transparent 70%)',
          }}
        />

        <div className="relative flex h-full min-h-0 flex-col">
          <img src={logoHorizontalWhite} alt="Neutrinos" className="h-6 w-auto shrink-0 self-start" />

          <div className="mt-5 shrink-0">
            <h1 className="neu-rise max-w-[18ch] font-sans text-[1.5rem] font-medium leading-[1.14] tracking-tight text-white xl:text-[1.85rem]">
              Hear your community before it speaks twice.
            </h1>
            <p
              className="neu-rise mt-2.5 hidden max-w-[44ch] text-sm font-light leading-relaxed text-white/65 xl:block"
              style={{ animationDelay: '80ms' }}
            >
              Every post read, every signal ranked — pain points, trends and sentiment turned into
              evidence-backed direction.
            </p>
          </div>

          {/* device pair: laptop (16:9 screen) + phone (9:16), shrinks to fit */}
          <div
            className="neu-rise flex min-h-0 flex-1 items-center justify-center"
            style={{ animationDelay: '160ms' }}
          >
            <div className="flex max-h-full min-h-0 items-end justify-center gap-5">
              {/* Laptop: light bezel so it reads against the dark blue panel */}
              <div className="flex min-h-0 flex-col items-center">
                <div className="min-h-0 rounded-lg bg-white/25 p-2 ring-1 ring-white/40 shadow-[0_20px_50px_-16px_rgba(0,0,0,0.5)]">
                  <img
                    src={shotLaptop}
                    alt="Community Insights dashboard on a laptop"
                    loading="eager"
                    decoding="async"
                    className="block h-auto max-h-[34dvh] w-auto max-w-full rounded-[3px] bg-white object-contain"
                  />
                </div>
                {/* laptop base — wider than the screen, like a real laptop */}
                <div className="h-2.5 w-[112%] shrink-0 rounded-b-[10px] bg-gradient-to-b from-white/45 to-white/25 ring-1 ring-white/30" />
                <div className="h-1 w-[18%] shrink-0 rounded-b-full bg-white/40" />
              </div>

              {/* Phone: iPhone 17 Pro Max frame (titanium) with status bar + Safari chrome */}
              <div className="hidden min-h-0 shrink-0 xl:flex">
                <div className="flex min-h-0 flex-col overflow-hidden rounded-[2.1rem] bg-gradient-to-b from-[#3a3f4a] to-[#1c2027] p-[3px] shadow-[0_24px_60px_-16px_rgba(0,0,0,0.8)] ring-1 ring-white/25">
                  {/* titanium side rails */}
                  <div className="min-h-0 overflow-hidden rounded-[1.95rem] bg-[#0b0f1a]">
                    <div className="relative flex max-h-[34dvh] flex-col">
                      {/* iOS status bar */}
                      <div className="flex shrink-0 items-center justify-between bg-white px-4 pt-1.5 pb-1 text-[8px] font-semibold text-black">
                        <span className="tabular-nums">9:41</span>
                        <span className="absolute left-1/2 top-0 h-4 w-16 -translate-x-1/2 rounded-b-[10px] bg-[#0b0f1a]" />
                        <span className="flex items-center gap-1">
                          <svg width="12" height="8" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5" width="3" height="7" rx="1"/><rect x="10" y="2" width="3" height="10" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
                          <svg width="14" height="8" viewBox="0 0 22 12" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="18" height="11" rx="3"/><rect x="2" y="2" width="13" height="8" rx="1.5" fill="currentColor"/><rect x="20" y="4" width="2" height="4" rx="1" fill="currentColor"/></svg>
                        </span>
                      </div>
                      {/* Safari URL bar */}
                      <div className="flex shrink-0 items-center justify-center gap-1.5 bg-white/95 px-3 pb-1.5 text-[8px] text-black/60">
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
                        <span className="truncate">comindash.jitinnair.com</span>
                      </div>
                      {/* page content */}
                      <img
                        src={shotPhone}
                        alt="Community Insights on an iPhone"
                        loading="lazy"
                        decoding="async"
                        className="block h-auto max-h-[26dvh] w-auto object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="neu-rise mt-5 flex shrink-0 gap-8 border-t border-white/10 pt-4"
            style={{ animationDelay: '240ms' }}
          >
            {STATS.map((s) => (
              <div key={s.label}>
                <div className="text-xl font-medium tabular-nums text-white">{s.value}</div>
                <div className="mt-0.5 text-[11px] font-light uppercase tracking-wider text-white/45">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ---------- Right: login card ---------- */}
      <main className="relative flex h-[100dvh] items-center justify-center overflow-hidden bg-white px-6 py-10 sm:px-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 lg:hidden"
          style={{
            background: 'radial-gradient(60% 40% at 50% 0%, rgba(0,102,255,0.10), transparent 70%)',
          }}
        />
        <div className="relative w-full max-w-sm">
          {/* mobile-only brand mark */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <img src={logoSymbolWhite} alt="" className="h-9 w-9 rounded-lg bg-midnight p-1.5" />
            <div>
              <div className="text-base font-medium text-black">Community Insights</div>
              <div className="text-xs text-muted">Neutrinos</div>
            </div>
          </div>

          <h2 className="neu-rise text-2xl font-medium tracking-tight text-black">Welcome back</h2>
          <p
            className="neu-rise mt-1.5 text-sm font-light text-muted"
            style={{ animationDelay: '60ms' }}
          >
            Enter your password to open the dashboard.
          </p>

          <form onSubmit={submit} className="neu-rise mt-8" style={{ animationDelay: '120ms' }}>
            <label htmlFor="pw" className="mb-2 block text-sm font-medium text-black">
              Password
            </label>
            <div className="relative">
              <input
                id="pw"
                ref={inputRef}
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className={`w-full rounded-xl border bg-white px-4 py-3 pr-12 text-black outline-none transition-[border-color,box-shadow] duration-300 focus:border-blue focus:ring-4 focus:ring-blue/15 disabled:opacity-60 ${
                  error ? 'border-red-300' : 'border-line'
                }`}
                placeholder="••••••••"
                style={{ animationName: shake ? 'shake' : undefined }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                aria-pressed={showPw}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted transition-colors hover:text-black"
                tabIndex={-1}
              >
                {showPw ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3l18 18" />
                    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                    <path d="M9.4 5.2A10.5 10.5 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.2-2.3 3.3M6.2 6.2C3.9 7.7 2.5 10 2 12c1 2.5 5 7 10 7 1.2 0 2.3-.3 3.3-.7" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !password}
              className="group mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-blue px-6 py-3.5 font-medium text-white shadow-[0_10px_30px_-10px_rgba(0,102,255,0.6)] transition-all duration-300 hover:brightness-110 disabled:opacity-50"
            >
              {busy ? 'Checking…' : 'Unlock dashboard'}
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white/15 transition-transform duration-300 group-hover:translate-x-0.5">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </button>
          </form>

          <p
            className="neu-rise mt-6 text-center text-xs font-light text-muted"
            style={{ animationDelay: '180ms' }}
          >
            Session signs out automatically after {idleMinutes} minutes of inactivity.
          </p>
        </div>
      </main>
    </div>
  )
}
