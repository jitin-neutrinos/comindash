"""Incremental Discourse client.

Patterns ported from the MVP (source/discourse-insights discourse_client.py):
- 429 handling that respects the ``Retry-After`` header
- a small self-throttle delay between requests (good API citizenship)
- a semaphore bounding concurrent topic fetches
- HTML body cleaning that strips quotes / code blocks / oneboxes before text
  extraction (duplicate and noisy content must not reach the models)

New in this port (SPEC.md): incremental since-cursor topic discovery and
fetching ALL posts of a topic (replies included) via the post stream.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings

logger = logging.getLogger("discourse")


class DiscourseAPIError(Exception):
    pass


def parse_dt(value: str | None) -> datetime | None:
    """Parse a Discourse ISO timestamp into an aware UTC datetime."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def author_hash(username: str) -> str:
    return hashlib.sha256((username or "unknown").encode()).hexdigest()[:16]


class DiscourseClient:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        api_username: str | None = None,
        max_pages: int | None = None,
        category_id: int | None = None,
        retry_wait_mult: float = 1.0,
    ):
        s = get_settings()
        self.base_url = (base_url or s.discourse_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else s.discourse_api_key
        self.api_username = (
            api_username if api_username is not None else s.discourse_api_username
        )
        self.max_pages = max_pages if max_pages is not None else s.discourse_max_pages
        self.backfill_max_pages = s.discourse_backfill_max_pages
        self.category_id = (
            category_id
            if category_id is not None
            else (s.discourse_category_id or None)
        )
        self.excluded_category_ids: set[int] = {
            int(x)
            for x in (s.discourse_excluded_category_ids or "").split(",")
            if x.strip()
        }
        self.request_delay = s.discourse_request_delay_ms / 1000
        self.timeout = s.discourse_timeout_ms / 1000
        self.retry_wait_mult = retry_wait_mult
        self.post_chunk_size = s.discourse_post_chunk_size
        self._semaphore = asyncio.Semaphore(s.discourse_max_concurrency)
        self._category_names: dict[int, str] | None = None
        # Global rate limiter state (shared across every request this client makes)
        self._min_interval = max(self.request_delay, 0.25)
        self._last_request_at: float = 0.0
        self._throttle_lock = asyncio.Lock()

    async def _global_throttle(self) -> None:
        """Ensure at least ``_min_interval`` seconds between any two requests,
        regardless of which concurrent task issues them."""
        async with self._throttle_lock:
            loop_time = asyncio.get_running_loop().time()
            wait = self._last_request_at + self._min_interval - loop_time
            if wait > 0:
                await asyncio.sleep(wait)
                loop_time = asyncio.get_running_loop().time()
            self._last_request_at = loop_time

    # --- plumbing -----------------------------------------------------------

    def _headers(self) -> dict:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["Api-Key"] = self.api_key
            headers["Api-Username"] = self.api_username or "system"
        return headers

    @staticmethod
    def strip_html(html: str) -> str:
        """Rendered post HTML → clean plain text for the models.

        Quotes (aside.quote / blockquote) repeat another post verbatim,
        code blocks burn tokens without clustering signal, and onebox link
        previews inject the target page's text — none of it is the poster's
        own words, so all three are removed before flattening.
        """
        soup = BeautifulSoup(html or "", "lxml")
        for quote in soup.select("aside.quote, blockquote"):
            quote.decompose()
        for code in soup.select("pre, code"):
            code.replace_with(" [code snippet omitted] ")
        for onebox in soup.select("aside.onebox"):
            onebox.decompose()
        return " ".join(soup.get_text(" ", strip=True).split())

    async def _get(
        self,
        client: httpx.AsyncClient,
        path: str,
        params: dict | list[tuple[str, str]] | None = None,
    ) -> dict:
        url = f"{self.base_url}{path}"

        @retry(
            stop=stop_after_attempt(5),
            wait=wait_exponential(multiplier=self.retry_wait_mult, min=1, max=30),
            retry=retry_if_exception_type((httpx.HTTPError,)),
            reraise=True,
        )
        async def _do() -> dict:
            # Global politeness limiter: one minimum interval between ANY two
            # requests across all concurrent tasks (prevents 429 storms that a
            # per-call sleep cannot, because N concurrent callers each sleep
            # after their own request and then all fire together).
            await self._global_throttle()
            resp = await client.get(url, params=params, timeout=self.timeout)
            if resp.status_code == 429:
                retry_after = min(float(resp.headers.get("Retry-After", "5")), 30.0)
                logger.warning(
                    "Discourse rate limit hit on %s — waiting %.1fs", url, retry_after
                )
                await asyncio.sleep(retry_after)
                await self._global_throttle()
                resp = await client.get(url, params=params, timeout=self.timeout)
            if resp.status_code == 403:
                raise DiscourseAPIError(
                    f"403 from {url} — check the API key's scope/username, or whether this "
                    f"category requires authentication."
                )
            resp.raise_for_status()
            return resp.json()

        return await _do()

    # --- categories -----------------------------------------------------------

    async def category_map(
        self, client: httpx.AsyncClient | None = None
    ) -> dict[int, str]:
        if self._category_names is not None:
            return self._category_names
        owns_client = client is None
        ctx = httpx.AsyncClient(headers=self._headers()) if owns_client else client
        assert ctx is not None
        try:
            data = await self._get(ctx, "/categories.json")
            cats = data.get("category_list", {}).get("categories", [])
            self._category_names = {c["id"]: c["name"] for c in cats}
        except Exception as e:  # noqa: BLE001 — categories are a nice-to-have
            logger.warning("Could not load categories: %s", e)
            self._category_names = {}
        finally:
            if owns_client:
                await ctx.aclose()
        return self._category_names

    # --- incremental topic discovery ------------------------------------------

    def _topic_list_path(self, page: int) -> tuple[str, dict]:
        if self.category_id:
            return f"/c/{self.category_id}.json", {"page": page}
        return "/latest.json", {"page": page}

    async def fetch_topics_since(
        self, since: datetime | None = None
    ) -> tuple[list[dict], int, bool]:
        """Page through the latest-topics feed, stopping at the cursor.

        Returns (topics, pages_done, truncated). ``latest.json`` is ordered by
        ``last_posted_at`` desc, so the first topic older than ``since`` means
        everything after it is old too.

        With no cursor this is the FIRST pass — a backfill — and it runs to the
        end of the feed (``discourse_backfill_max_pages``). Applying the small
        incremental cap here silently truncates forum history: the cursor is
        then set to the newest topic and everything older becomes permanently
        unreachable. ``truncated`` says the cap was hit, so the caller can
        refuse to advance the cursor.
        """
        headers = self._headers()
        topics: list[dict] = []
        pages_done = 0
        max_pages = self.backfill_max_pages if since is None else self.max_pages
        truncated = False
        async with httpx.AsyncClient(headers=headers) as client:
            categories = await self.category_map(client)
            page = 0
            while page < max_pages:
                path, params = self._topic_list_path(page)
                logger.info(
                    "Fetching Discourse topic list page %d: %s%s",
                    page,
                    self.base_url,
                    path,
                )
                try:
                    data = await self._get(client, path, params=params)
                except Exception as e:  # noqa: BLE001
                    if page == 0:
                        # First page failing means something is actually wrong
                        # (network, blocked, bad URL, wrong category) — raise so
                        # the pipeline run is marked failed with a real error.
                        raise DiscourseAPIError(
                            f"Could not fetch topics from {self.base_url}{path}: {e}"
                        ) from e
                    logger.error(
                        "Failed to fetch %s after retries: %s — stopping pagination, keeping %d topics",
                        path,
                        e,
                        len(topics),
                    )
                    break

                raw = data.get("topic_list", {}).get("topics", [])
                if not raw:
                    break

                reached_cursor = False
                for topic in raw:
                    last_posted = parse_dt(
                        topic.get("last_posted_at") or topic.get("created_at")
                    )
                    if (
                        since is not None
                        and last_posted is not None
                        and last_posted <= since
                    ):
                        reached_cursor = True
                        break
                    if self.excluded_category_ids and topic.get(
                        "category_id", -1
                    ) in self.excluded_category_ids:
                        continue
                    topics.append(
                        {
                            "discourse_topic_id": topic["id"],
                            "title": topic.get("title", ""),
                            "slug": topic.get("slug", ""),
                            "category": categories.get(
                                topic.get("category_id", -1), ""
                            ),
                            "created_at": parse_dt(topic.get("created_at")),
                            "last_posted_at": last_posted,
                            "posts_count": topic.get("posts_count", 0),
                            "views": topic.get("views", 0),
                            "like_count": topic.get("like_count", 0),
                        }
                    )
                pages_done = page + 1
                if reached_cursor or not data.get("topic_list", {}).get(
                    "more_topics_url"
                ):
                    break
                page += 1
                await asyncio.sleep(self.request_delay)
            else:
                # loop exhausted the page budget without reaching the cursor or
                # the end of the feed — there is more history we did not fetch
                truncated = True

        logger.info(
            "Topic fetch complete: %d topics (%s pass, %d pages%s)",
            len(topics),
            "backfill" if since is None else "incremental",
            pages_done,
            ", TRUNCATED at page cap" if truncated else "",
        )
        if truncated:
            logger.warning(
                "Topic pagination hit the %d-page cap — older topics were not "
                "fetched and the ingestion cursor will not be advanced",
                max_pages,
            )
        return topics, pages_done, truncated

    # --- full topic posts --------------------------------------------------------

    async def _fetch_posts_chunk(
        self, client: httpx.AsyncClient, topic_id: int, ids: list[int]
    ) -> list[dict]:
        # Discourse's real param name is post_ids[], not ids[] — the wrong
        # name was silently ignored, so every call fell back to the
        # endpoint's default ~20-post window no matter what was requested.
        params = [("post_ids[]", str(i)) for i in ids]
        data = await self._get(client, f"/t/{topic_id}/posts.json", params=params)
        # real Discourse nests these under post_stream, same as /t/{id}.json —
        # a flat "posts" key never exists here, so this silently returned []
        return data.get("post_stream", {}).get("posts", [])

    async def fetch_topic_posts(
        self, client: httpx.AsyncClient, topic_id: int
    ) -> tuple[list[dict], str | None]:
        """ALL posts of a topic (replies included) via the post stream.

        Returns ``(posts, error)`` — ``error`` is a short reason string when
        the topic could not be fetched, so the caller can count the failure on
        the run stats instead of it vanishing into an empty list.
        """
        async with self._semaphore:
            try:
                data = await self._get(client, f"/t/{topic_id}.json")
                stream_ids: list[int] = data.get("post_stream", {}).get("stream", [])
                if not stream_ids:
                    raw_posts = data.get("post_stream", {}).get("posts", [])
                    stream_ids = [p["id"] for p in raw_posts if "id" in p]

                declared = data.get("posts_count", len(stream_ids))
                if len(stream_ids) < declared:
                    # seen under sustained concurrent load: stream comes back
                    # holding only the default ~20-post window instead of every
                    # id, with no error — one retry after a beat usually gets
                    # the full list; if not, at least this is now visible
                    # instead of silently under-storing the topic forever.
                    await asyncio.sleep(1.0)
                    data = await self._get(client, f"/t/{topic_id}.json")
                    stream_ids = data.get("post_stream", {}).get("stream", [])
                    if len(stream_ids) < declared:
                        logger.warning(
                            "Topic %s: post stream has %d ids but posts_count=%d "
                            "after retry — storing what's available",
                            topic_id,
                            len(stream_ids),
                            declared,
                        )

                posts: list[dict] = []
                for i in range(0, len(stream_ids), self.post_chunk_size):
                    chunk = stream_ids[i : i + self.post_chunk_size]
                    raw_posts = await self._fetch_posts_chunk(client, topic_id, chunk)
                    for p in raw_posts:
                        posts.append(
                            {
                                "discourse_post_id": p["id"],
                                "post_number": p.get("post_number", 1),
                                "author_hash": author_hash(p.get("username", "")),
                                "body_text": self.strip_html(p.get("cooked", "")),
                                "created_at": parse_dt(p.get("created_at")),
                                "updated_at": parse_dt(p.get("updated_at")),
                            }
                        )
                    await asyncio.sleep(self.request_delay)
                return posts, None
            except Exception as e:  # noqa: BLE001 — one bad topic must not kill the run
                logger.warning("Could not fetch posts for topic %s: %s", topic_id, e)
                return [], f"{type(e).__name__}: {e}"[:200]
            finally:
                await asyncio.sleep(self.request_delay)

    async def fetch_all_posts(
        self, topic_ids: list[int]
    ) -> tuple[dict[int, list[dict]], dict[int, str]]:
        headers = self._headers()
        out: dict[int, list[dict]] = {}
        failures: dict[int, str] = {}
        async with httpx.AsyncClient(headers=headers) as client:
            tasks = [self.fetch_topic_posts(client, tid) for tid in topic_ids]
            results = await asyncio.gather(*tasks)
        for tid, (posts, error) in zip(topic_ids, results):
            out[tid] = posts
            if error is not None:
                failures[tid] = error
        return out, failures
