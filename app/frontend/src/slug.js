/**
 * URL slugs for insights — the JS mirror of backend/app/services/slugs.py.
 *
 * The backend already returns a `slug` on every insight payload, so this is
 * only needed where the UI must build a link before it has the payload (or
 * must read an id back out of the current route). Both sides are verified
 * against the same vector list in slug.test.mjs so they can never drift.
 *
 * Self-check: `node src/slug.test.mjs`
 */

const MAX_SLUG_WORDS = 12
const MAX_SLUG_CHARS = 80

/** Lowercase, ASCII, hyphen-joined. Deterministic and idempotent. */
export function slugify(text) {
  if (!text) return ''
  // NFKD + strip combining marks == Python's unicodedata NFKD + ascii ignore.
  const asciiOnly = String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
  const words = asciiOnly.split(/[^a-z0-9]+/).filter(Boolean)
  let slug = words.slice(0, MAX_SLUG_WORDS).join('-')
  if (slug.length > MAX_SLUG_CHARS) {
    slug = slug.slice(0, MAX_SLUG_CHARS)
    const cut = slug.lastIndexOf('-')
    if (cut > 0) slug = slug.slice(0, cut)
  }
  return slug.replace(/^-+|-+$/g, '')
}

/** Canonical URL segment for an insight: `<slug>-<id>`. */
export function insightSlug(id, title) {
  const base = slugify(title)
  return base ? `${base}-${id}` : String(id)
}

/** Split a URL segment into { id, slug }; id is null when absent. */
export function parseRef(ref) {
  const clean = String(ref ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (!clean) return { id: null, slug: '' }
  if (/^\d+$/.test(clean)) return { id: Number(clean), slug: '' }
  const m = clean.match(/^(.*?)-(\d+)$/)
  if (m) return { id: Number(m[2]), slug: m[1] }
  return { id: null, slug: slugify(clean) }
}

/**
 * Route path for an insight. Prefers the server-provided slug so the URL is
 * always the canonical one; falls back to deriving it when only a title is
 * at hand.
 */
export const insightPath = (insight) => {
  if (!insight) return '/insights'
  const ref = insight.slug || insightSlug(insight.id, insight.title)
  return `/insights/${ref}`
}
