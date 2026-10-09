import { useCallback, useEffect, useRef, useState } from 'react'
import { login, logout as apiLogout } from '../api'
import { useIdleLogout } from '../auth'
import logoSymbolWhite from '../brand/logo/neutrinos-symbol-white.png'
import logoHorizontalWhite from '../brand/logo/neutrinos-horizontal-white-tagline.png'
import { SkeletonScreen, SkeletonStage, useSkeletonRotation } from './SkeletonScreen'
import iphoneFrame from '../marketing/iphone17-promax-frame.png'
import macbookFrame from '../marketing/macbook-pro-16-frame.png'

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
  const { page, leavingPage, ref: skRef } = useSkeletonRotation()
  const { page: phonePage, leavingPage: phoneLeaving, ref: phoneRef } = useSkeletonRotation()

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
          <img src={logoHorizontalWhite} alt="Neutrinos" className="h-12 w-auto shrink-0 self-start" />

          <div className="mt-5 shrink-0">
            {/* Each of these is a single line that wraps only at the section
                edge (no max-w constraint) — one sentence, one line. */}
            <h1 className="neu-rise font-sans text-[1.5rem] font-medium leading-[1.2] tracking-tight text-white xl:text-[1.85rem]">
              Hear your community before it speaks twice.
            </h1>
            <p
              className="neu-rise mt-2.5 text-sm font-light leading-relaxed text-white/85"
              style={{ animationDelay: '80ms' }}
            >
              Every post read, every signal ranked — pain points, trends and sentiment turned into
              evidence-backed direction.
            </p>
          </div>

          {/* device pair: MacBook Pro 16 with an iPhone 17 Pro Max in front.
              Both are sized in vw units (dynamic) and capped so they can never
              overlap the headline above or the stats line below, nor overflow
              the panel's right edge. The MacBook renders full-screen: the
              skeleton fills the whole screen area, no blue gap above. */}
          <div
            className="neu-rise relative min-h-0 flex-1"
            style={{ animationDelay: '160ms' }}
          >
            {/* Laptop — left-anchored, ~30% smaller again, true 1.5:1 body */}
            <div
              className="absolute"
              style={{
                left: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 'clamp(240px, 46vw, 620px)',
                aspectRatio: '4256 / 2834',
              }}
            >
              <div
                className="absolute overflow-hidden bg-white"
                style={{
                  left: `${(400 / 4256) * 100}%`,
                  top: `${(364 / 2834) * 100}%`,
                  width: `${(3456 / 4256) * 100}%`,
                  height: `${(2170 / 2834) * 100}%`,
                  borderRadius: '0.8%',
                }}
              >
                <SkeletonStage form="laptop" page={page} leavingPage={leavingPage} hostRef={skRef} />
              </div>
              <img
                src={macbookFrame}
                alt="Community Insights on a MacBook Pro 16"
                loading="eager"
                decoding="async"
                className="pointer-events-none absolute inset-0 h-full w-full drop-shadow-[0_28px_55px_rgba(0,0,0,0.5)]"
              />
            </div>

            {/* Phone — in front, right of centre, sized in vw so it scales with
                the viewport and stays clear of the panel edges. */}
            <div
              className="absolute z-10 hidden xl:block"
              style={{
                left: 'clamp(300px, 40vw, 540px)',
                top: '50%',
                transform: 'translateY(-42%)',
                width: 'clamp(70px, 9vw, 130px)',
                aspectRatio: '1520 / 3068',
              }}
            >
              <div
                className="absolute overflow-hidden bg-[#fbfbfd]"
                style={{
                  left: '6.58%',
                  top: '3.26%',
                  width: '86.84%',
                  height: '93.48%',
                  borderRadius: '13% / 6.5%',
                }}
              >
                <SkeletonStage form="phone" page={phonePage} leavingPage={phoneLeaving} hostRef={phoneRef} />
              </div>
              <img
                src={iphoneFrame}
                alt="Community Insights on an iPhone 17 Pro Max"
                loading="lazy"
                decoding="async"
                className="pointer-events-none absolute inset-0 h-full w-full drop-shadow-[0_22px_40px_rgba(0,0,0,0.75)]"
              />
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
      <main className="neu-login-light relative flex h-[100dvh] items-center justify-center overflow-hidden bg-white px-6 py-10 sm:px-10">
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
            className="neu-rise mt-1.5 text-sm text-black/70"
            style={{ animationDelay: '60ms' }}
          >
            Enter your password to open the dashboard.
          </p>

          <form onSubmit={submit} className="neu-rise mt-8" style={{ animationDelay: '120ms' }}>
            <label htmlFor="pw" className="mb-2 block text-sm font-semibold text-black">
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
            className="neu-rise mt-6 text-center text-xs text-black/70"
            style={{ animationDelay: '180ms' }}
          >
            Session signs out automatically after {idleMinutes} minutes of inactivity.
          </p>
        </div>
      </main>
    </div>
  )
}
