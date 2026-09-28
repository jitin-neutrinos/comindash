"""Human-readable URLs for insights.

Canonical form is ``<slugified-title>-<id>`` — e.g.
``stale-jbpm-async-jobs-caused-two-production-incidents-30``.

Why the trailing id rather than a bare slug: insight titles are written by the
analyst and are neither unique nor stable. Three cycles produced three
near-identical "Alpha UI field validations..." titles, and a re-run can reword
one. A bare slug would collide between them and 404 whenever a title changed.
The id suffix makes every link permanent and the lookup O(1), while the slug
carries the meaning — the same trade Stack Overflow and Medium make.

Resolution is forgiving in one direction only: a hand-typed bare slug (no id)
still resolves, preferring the newest active insight whose title matches. A
wrong slug on a valid id is NOT an error — the id wins and the caller is told
the canonical form so it can correct the URL.

No migration and no slug column: the slug is derived from the title, so it can
never drift out of sync with it.

Self-check: ``python -m app.services.slugs``
"""

from __future__ import annotations

import re
import unicodedata

MAX_SLUG_WORDS = 12
MAX_SLUG_CHARS = 80

_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_ID_SUFFIX = re.compile(r"^(?P<slug>.*?)-(?P<id>\d+)$")


def slugify(text: str) -> str:
    """Lowercase, ASCII, hyphen-joined. Deterministic and idempotent.

    Kept intentionally simple so the JS mirror (frontend/src/slug.js) can be
    byte-identical — the two are checked against a shared vector list.
    """
    if not text:
        return ""
    # Normalise accents to ASCII (é -> e) so URLs stay plain.
    norm = unicodedata.normalize("NFKD", str(text))
    ascii_only = norm.encode("ascii", "ignore").decode("ascii").lower()
    words = [w for w in _NON_ALNUM.split(ascii_only) if w]
    slug = "-".join(words[:MAX_SLUG_WORDS])
    if len(slug) > MAX_SLUG_CHARS:
        slug = slug[:MAX_SLUG_CHARS].rsplit("-", 1)[0]
    return slug.strip("-")


def insight_slug(insight_id: int, title: str) -> str:
    """Canonical URL segment for an insight."""
    base = slugify(title)
    return f"{base}-{insight_id}" if base else str(insight_id)


def parse_ref(ref: str) -> tuple[int | None, str]:
    """Split a URL segment into (id, slug).

    Returns ``(None, slug)`` when the segment carries no id — the caller then
    resolves by title match.
    """
    ref = (ref or "").strip().strip("/")
    if not ref:
        return None, ""
    if ref.isdigit():
        return int(ref), ""
    m = _ID_SUFFIX.match(ref)
    if m:
        return int(m.group("id")), m.group("slug")
    return None, slugify(ref)


def _self_check() -> None:
    # VECTORS is the cross-language contract, mirrored byte-for-byte in
    # frontend/src/slug.test.mjs. Change one side without the other and both
    # self-checks fail.
    vectors = [
        ("Hello, World!", "hello-world"),
        ("  Multiple   spaces  ", "multiple-spaces"),
        ("Café déjà vu", "cafe-deja-vu"),
        ("jBPM/async — jobs", "jbpm-async-jobs"),
        ("", ""),
        ("!!!", ""),
        ("Release 26.01.05", "release-26-01-05"),
        (
            "Stale jBPM async jobs caused two production incidents, including "
            "a 14-month-old claim re-running live backend calls",
            "stale-jbpm-async-jobs-caused-two-production-incidents-including-a-14-month",
        ),
    ]
    for raw, expected in vectors:
        assert slugify(raw) == expected, (raw, slugify(raw), expected)
        # Idempotent: slugifying a slug is a no-op.
        assert slugify(expected) == expected, expected

    assert slugify("A" * 200).startswith("a")
    long = slugify("word " * 40)
    assert len(long) <= MAX_SLUG_CHARS, len(long)
    assert not long.endswith("-")

    long_title = vectors[-1][0]
    ref = insight_slug(30, long_title)
    assert ref.endswith("-30"), ref
    assert parse_ref(ref)[0] == 30
    assert parse_ref("30") == (30, "")
    assert parse_ref("/30/") == (30, "")
    assert parse_ref("")[0] is None
    # A bare slug carries no id and is normalised for title matching.
    assert parse_ref("Alpha UI Validation") == (None, "alpha-ui-validation")
    # A title that itself ends in digits must not be mistaken for an id-only ref.
    assert insight_slug(7, "Release 26.01.05") == "release-26-01-05-7"
    assert parse_ref("release-26-01-05-7") == (7, "release-26-01-05")
    # Round-trip for every id shape the app can produce.
    for i in (1, 7, 30, 12345):
        assert parse_ref(insight_slug(i, "Some Title Here"))[0] == i
    # An untitled insight still produces a usable ref.
    assert insight_slug(9, "") == "9"
    print(f"slugs self-check OK — {len(vectors)} vectors")


if __name__ == "__main__":  # pragma: no cover - manual self-check
    _self_check()
