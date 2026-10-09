import { useEffect, useRef, useState } from 'react'
import { logout as apiLogout } from './api'

/**
 * Idle auto-logoff (industry-standard client-side inactivity timeout).
 *
 * The server token has an absolute TTL; this adds the *idle* half — the
 * convention used by banking/enterprise dashboards: sign the user out after N
 * minutes with no interaction, but first show a warning with a countdown so a
 * session is never dropped mid-task without notice.
 *
 * Efficiency: the activity listeners are passive (no preventDefault, no
 * capture) and the timer is a single setTimeout that is only re-armed on real
 * user events, so there is no polling loop and no per-render cost.
 */

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'visibilitychange']

export function useIdleLogout({ enabled, idleMinutes, warningSeconds = 60, onLogout }) {
  const [warning, setWarning] = useState(null) // seconds left, or null
  const idleTimer = useRef(null)
  const warnTimer = useRef(null)
  const countdown = useRef(null)
  const lastActivity = useRef(Date.now())

  useEffect(() => {
    if (!enabled || !idleMinutes) return

    const idleMs = idleMinutes * 60 * 1000

    const clearAll = () => {
      clearTimeout(idleTimer.current)
      clearTimeout(warnTimer.current)
      clearInterval(countdown.current)
    }

    const signOut = () => {
      clearAll()
      setWarning(null)
      onLogout?.()
    }

    const startWarning = () => {
      let left = warningSeconds
      setWarning(left)
      countdown.current = setInterval(() => {
        left -= 1
        if (left <= 0) signOut()
        else setWarning(left)
      }, 1000)
    }

    const arm = () => {
      clearAll()
      setWarning(null)
      // Warn this long before the idle deadline.
      warnTimer.current = setTimeout(startWarning, Math.max(0, idleMs - warningSeconds * 1000))
      idleTimer.current = setTimeout(signOut, idleMs)
    }

    const onActivity = () => {
      const now = Date.now()
      // Throttle: ignore events closer than 1s apart so scroll/mousemove
      // storms don't re-arm the timer thousands of times.
      if (now - lastActivity.current < 1000) return
      lastActivity.current = now
      arm()
    }

    // A backgrounded tab that comes back after the deadline should log out
    // immediately rather than waiting for the next timer tick.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastActivity.current >= idleMs) signOut()
        else onActivity()
      }
    }

    ACTIVITY_EVENTS.forEach((e) =>
      document.addEventListener(e, e === 'visibilitychange' ? onVisibility : onActivity, { passive: true }),
    )
    arm()

    return () => {
      clearAll()
      ACTIVITY_EVENTS.forEach((e) =>
        document.removeEventListener(e, e === 'visibilitychange' ? onVisibility : onActivity),
      )
    }
  }, [enabled, idleMinutes, warningSeconds, onLogout])

  const staySignedIn = () => {
    // User clicked "stay" — treat as activity and re-arm.
    lastActivity.current = Date.now()
    setWarning(null)
    window.dispatchEvent(new Event('mousedown'))
  }

  return { warning, staySignedIn }
}

export async function logout() {
  try {
    await apiLogout()
  } catch {
    // even if the network call fails, drop the local session
  }
}
