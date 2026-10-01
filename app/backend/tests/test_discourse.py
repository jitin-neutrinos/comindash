"""Discourse client: HTML stripping, incremental discovery, all-posts fetch,
429 Retry-After. All HTTP is respx-mocked — zero external calls."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import respx
from httpx import Response

from app.services.discourse import (
    DiscourseAPIError,
    DiscourseClient,
    as_utc,
    author_hash,
    parse_dt,
)

BASE = "https://forum.test"
NOW = datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc)


def _client(**kwargs) -> DiscourseClient:
    defaults = {"base_url": BASE, "retry_wait_mult": 0}
    defaults.update(kwargs)
    return DiscourseClient(**defaults)


def _topic(tid: int, title: str, age_hours: float, category_id: int = 7) -> dict:
    ts = (NOW - timedelta(hours=age_hours)).isoformat()
    return {
        "id": tid,
        "title": title,
        "slug": title.lower().replace(" ", "-"),
        "category_id": category_id,
        "created_at": ts,
        "last_posted_at": ts,
        "posts_count": 2,
        "views": 50,
        "like_count": 1,
    }


class TestStripHtml:
    def test_quotes_removed(self):
        html = "<p>Real text</p><aside class='quote'><div>quoted junk</div></aside>"
        assert "quoted junk" not in DiscourseClient.strip_html(html)
        assert "Real text" in DiscourseClient.strip_html(html)

    def test_blockquotes_removed(self):
        html = "<p>Opinion</p><blockquote>earlier post verbatim</blockquote>"
        out = DiscourseClient.strip_html(html)
        assert "earlier post" not in out
        assert "Opinion" in out

    def test_code_replaced_with_marker(self):
        html = "<p>It fails here:</p><pre><code>Traceback line1\nline2</code></pre>"
        out = DiscourseClient.strip_html(html)
        assert "Traceback" not in out
        assert "[code snippet omitted]" in out

    def test_onebox_removed(self):
        html = "<p>See link</p><aside class='onebox'>Scraped page title and preview</aside>"
        out = DiscourseClient.strip_html(html)
        assert "Scraped page" not in out
        assert "See link" in out

    def test_whitespace_collapsed(self):
        assert DiscourseClient.strip_html("<p>a\n\n  b</p><p>c</p>") == "a b c"

    def test_empty_and_none(self):
        assert DiscourseClient.strip_html("") == ""
        assert DiscourseClient.strip_html(None) == ""


class TestHelpers:
    def test_parse_dt_z_suffix(self):
        assert parse_dt("2026-09-09T10:00:00Z") == datetime(
            2026, 9, 9, 10, 0, tzinfo=timezone.utc
        )

    def test_parse_dt_naive_becomes_utc(self):
        assert parse_dt("2026-09-09T10:00:00").tzinfo is not None

    def test_parse_dt_garbage(self):
        assert parse_dt("not-a-date") is None
        assert parse_dt(None) is None

    def test_as_utc(self):
        assert as_utc(None) is None
        assert as_utc(datetime(2026, 1, 1)).tzinfo is not None

    def test_author_hash_deterministic(self):
        assert author_hash("alice") == author_hash("alice")
        assert author_hash("alice") != author_hash("bob")
        assert len(author_hash("alice")) == 16


class TestFetchTopicsSince:
    @respx.mock
    async def test_stops_at_cursor(self):
        since = NOW - timedelta(days=1)
        older = _topic(1, "Old topic", age_hours=72)  # before cursor
        newer = _topic(2, "New topic", age_hours=5)
        respx.get(f"{BASE}/categories.json").respond(
            json={
                "category_list": {
                    "categories": [{"id": 7, "name": "eng", "slug": "eng"}]
                }
            }
        )
        respx.get(f"{BASE}/latest.json").respond(
            json={
                "topic_list": {"topics": [newer, older], "more_topics_url": "?page=1"}
            }
        )
        topics, pages, truncated = await _client().fetch_topics_since(since)
        assert [t["discourse_topic_id"] for t in topics] == [2]
        assert topics[0]["category"] == "eng"
        assert pages == 1

    @respx.mock
    async def test_no_cursor_fetches_all_pages(self):
        page0 = {
            "topic_list": {"topics": [_topic(1, "A", 1)], "more_topics_url": "?page=1"}
        }
        page1 = {"topic_list": {"topics": [_topic(2, "B", 2)], "more_topics_url": None}}
        respx.get(f"{BASE}/categories.json").respond(
            json={"category_list": {"categories": []}}
        )
        route = respx.get(f"{BASE}/latest.json")
        route.side_effect = [
            Response(200, json=page0),
            Response(200, json=page1),
        ]
        topics, pages, truncated = await _client().fetch_topics_since(None)
        assert len(topics) == 2
        assert pages == 2
        # feed ended on its own, so nothing was cut off
        assert truncated is False

    @respx.mock
    async def test_excluded_category_dropped(self):
        respx.get(f"{BASE}/categories.json").respond(
            json={
                "category_list": {
                    "categories": [
                        {"id": 7, "name": "eng", "slug": "eng"},
                        {"id": 42, "name": "Bot Testing", "slug": "bot-testing"},
                    ]
                }
            }
        )
        bot = _topic(9, "Internal test", age_hours=1, category_id=42)
        real = _topic(2, "Real topic", age_hours=2, category_id=7)
        respx.get(f"{BASE}/latest.json").respond(
            json={"topic_list": {"topics": [bot, real], "more_topics_url": None}}
        )
        topics, _, _ = await _client().fetch_topics_since(None)
        assert [t["discourse_topic_id"] for t in topics] == [2]

    @respx.mock
    async def test_first_page_failure_raises(self):
        respx.get(f"{BASE}/categories.json").respond(
            json={"category_list": {"categories": []}}
        )
        respx.get(f"{BASE}/latest.json").respond(status_code=500)
        with pytest.raises(DiscourseAPIError):
            await _client().fetch_topics_since(None)

    @respx.mock
    async def test_429_respects_retry_after(self):
        respx.get(f"{BASE}/categories.json").respond(
            json={"category_list": {"categories": []}}
        )
        route = respx.get(f"{BASE}/latest.json")
        route.side_effect = [
            Response(429, headers={"Retry-After": "0"}),
            Response(
                200,
                json={
                    "topic_list": {
                        "topics": [_topic(1, "A", 1)],
                        "more_topics_url": None,
                    }
                },
            ),
        ]
        topics, _, _ = await _client().fetch_topics_since(None)
        assert len(topics) == 1
        assert route.call_count == 2

    @respx.mock
    async def test_api_key_headers_sent(self):
        respx.get(f"{BASE}/categories.json").respond(
            json={"category_list": {"categories": []}}
        )
        route = respx.get(f"{BASE}/latest.json").respond(
            json={"topic_list": {"topics": [], "more_topics_url": None}}
        )
        await _client(api_key="secret", api_username="admin").fetch_topics_since(None)
        sent = route.calls.last.request.headers
        assert sent.get("Api-Key") == "secret"
        assert sent.get("Api-Username") == "admin"


class TestFetchTopicPosts:
    @respx.mock
    async def test_all_posts_via_stream(self):
        import httpx

        topic_json = {
            "post_stream": {
                "stream": [501, 502],
                "posts": [],
            }
        }
        respx.get(f"{BASE}/t/42.json").respond(json=topic_json)
        posts_route = respx.get(f"{BASE}/t/42/posts.json").respond(
            json={
                # real Discourse nests these under post_stream, same as
                # /t/{id}.json — a flat "posts" key never exists here
                "post_stream": {
                    "posts": [
                        {
                            "id": 501,
                            "post_number": 1,
                            "username": "alice",
                            "cooked": "<p>Root post</p>",
                            "created_at": "2026-09-08T10:00:00Z",
                            "updated_at": "2026-09-08T10:00:00Z",
                        },
                        {
                            "id": 502,
                            "post_number": 2,
                            "username": "bob",
                            "cooked": "<p>Reply</p><aside class='quote'>noise</aside>",
                            "created_at": "2026-09-08T11:00:00Z",
                            "updated_at": "2026-09-08T11:00:00Z",
                        },
                    ]
                }
            }
        )
        async with httpx.AsyncClient() as http:
            posts, _error = await _client().fetch_topic_posts(http, 42)
        assert [p["discourse_post_id"] for p in posts] == [501, 502]
        assert posts[1]["body_text"] == "Reply"  # quote stripped
        assert posts[0]["author_hash"] == author_hash("alice")
        assert posts[0]["created_at"] is not None
        # regression: Discourse's real param is post_ids[], not ids[] — the
        # wrong name is silently ignored and the endpoint falls back to its
        # default ~20-post window no matter what was requested
        sent_query = str(posts_route.calls.last.request.url.params)
        assert "post_ids" in sent_query
        assert "ids=" not in sent_query.replace("post_ids", "")

    @respx.mock
    async def test_one_bad_topic_does_not_raise(self):
        import httpx

        respx.get(f"{BASE}/t/43.json").respond(status_code=404)
        async with httpx.AsyncClient() as http:
            posts, error = await _client().fetch_topic_posts(http, 43)
        assert posts == []
        assert error is not None  # the failure is counted, not swallowed silently


class TestBackfillCap:
    """The first pass (no cursor) must not stop at the small incremental cap:
    capping it truncates forum history permanently, because the cursor is then
    set to the newest topic and older pages are never revisited."""

    @respx.mock
    async def test_backfill_uses_the_larger_cap_and_flags_truncation(self):
        respx.get(f"{BASE}/categories.json").respond(
            json={"category_list": {"categories": []}}
        )
        # an endless feed: every page says there is another one
        respx.get(f"{BASE}/latest.json").mock(
            return_value=Response(
                200,
                json={
                    "topic_list": {
                        "topics": [_topic(1, "A", 1)],
                        "more_topics_url": "?page=next",
                    }
                },
            )
        )
        client = _client()
        client.max_pages = 2  # incremental cap
        client.backfill_max_pages = 5  # backfill cap

        topics, pages, truncated = await client.fetch_topics_since(None)
        assert pages == 5, "backfill must use backfill_max_pages, not max_pages"
        assert truncated is True, "hitting the cap must be reported"

        topics, pages, truncated = await client.fetch_topics_since(
            datetime(2000, 1, 1, tzinfo=timezone.utc)
        )
        assert pages == 2, "incremental pass keeps the small cap"
        assert truncated is True
