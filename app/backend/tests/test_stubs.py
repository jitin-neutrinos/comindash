"""Stub analyzers: deterministic results stamped model_version='stub-1'."""

from __future__ import annotations

from app.models import Priority, Sentiment
from app.services.analysis.extraction import stub_ner
from app.services.analysis.priority import stub_priority
from app.services.analysis.sentiment import stub_sentiment
from tests.corpus import POST_BODIES


class TestStubSentiment:
    def test_negative_post(self):
        sentiment, intensity, confidence, _ = stub_sentiment(POST_BODIES[0])
        assert sentiment is Sentiment.neg
        assert 0.0 < intensity <= 1.0
        assert 0.5 <= confidence <= 0.95

    def test_positive_post(self):
        sentiment, _, _, _ = stub_sentiment(POST_BODIES[1])
        assert sentiment is Sentiment.pos

    def test_neutral_post(self):
        sentiment, intensity, confidence, _ = stub_sentiment(POST_BODIES[2])
        assert sentiment is Sentiment.neu
        assert intensity == 0.0
        assert confidence == 0.5

    def test_deterministic(self):
        assert stub_sentiment(POST_BODIES[0]) == stub_sentiment(POST_BODIES[0])

    def test_empty(self):
        assert stub_sentiment("") == (Sentiment.neu, 0.0, 0.5, None)


class TestStubPriority:
    def test_high(self):
        priority, confidence, _ = stub_priority(POST_BODIES[0])
        assert priority is Priority.high
        assert confidence >= 0.65

    def test_medium(self):
        priority, _, _ = stub_priority(POST_BODIES[1])  # "issue" → medium
        assert priority is Priority.medium

    def test_low(self):
        priority, _, _ = stub_priority(POST_BODIES[2])
        assert priority is Priority.low

    def test_deterministic(self):
        assert stub_priority(POST_BODIES[0]) == stub_priority(POST_BODIES[0])


class TestStubNer:
    def test_error_code_extracted(self):
        entities = stub_ner(POST_BODIES[0])
        labels = {e["entity_label"] for e in entities}
        texts = {e["entity_text"] for e in entities}
        assert "ERROR_CODE" in labels
        assert "ERROR-4021" in texts

    def test_version_extracted(self):
        entities = stub_ner(POST_BODIES[0])
        assert any(e["entity_label"] == "VERSION" for e in entities)

    def test_url_extracted(self):
        entities = stub_ner(POST_BODIES[1])
        assert any(e["entity_text"].startswith("https://") for e in entities)

    def test_positions_are_consistent(self):
        text = "Upgrade to version 4.2 reported by Neutrinos Studio"
        for e in stub_ner(text):
            assert text[e["start_pos"] : e["end_pos"]].strip() == e["entity_text"]

    def test_high_priority_label_wins_span(self):
        # "Neutrinos Studio" is a PRODUCT; the ENTITY regex would also match it
        entities = stub_ner("Love Neutrinos Studio")
        matches = [e for e in entities if "Neutrinos" in e["entity_text"]]
        assert matches and all(m["entity_label"] == "PRODUCT" for m in matches)

    def test_empty(self):
        assert stub_ner("") == []
