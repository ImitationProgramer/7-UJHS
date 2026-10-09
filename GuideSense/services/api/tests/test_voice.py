"""Realtime handshake contract with mocked provider; never records microphone audio."""

import io
import json
from email.parser import BytesParser
from email.policy import default
from urllib.error import HTTPError, URLError

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from guidesense_api import voice

OFFER = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
ORIGIN = {"Origin": "http://localhost:5173"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_REALTIME_MODEL", raising=False)
    monkeypatch.delenv("NAV_ALLOWED_ORIGINS", raising=False)
    app = FastAPI()
    voice.install_voice(app)
    with TestClient(app) as result:
        yield result


def post(client, **kwargs):
    return client.post("/api/navigation/voice/session", headers=ORIGIN, json={"sdp": OFFER}, **kwargs)


def test_missing_key_and_status(client, monkeypatch):
    assert client.get("/api/navigation/voice/status").json() == {"configured": False}
    assert post(client).json()["detail"]["code"] == "VOICE_KEY_MISSING"
    monkeypatch.setenv("OPENAI_API_KEY", "secret-test")
    assert client.get("/api/navigation/voice/status").json() == {"configured": True}


@pytest.mark.parametrize("origin", [None, "https://example.com", "null", "http://localhost:5173.evil.test"])
def test_origin_denied_before_upstream(client, monkeypatch, origin):
    monkeypatch.setattr(voice, "exchange_sdp", lambda *_: pytest.fail("must not call upstream"))
    response = client.post("/api/navigation/voice/session", json={"sdp": OFFER}, headers={"Origin": origin} if origin else {})
    assert response.status_code == 403


@pytest.mark.parametrize("payload", [{}, {"sdp": 1}, {"sdp": "not-sdp"}, {"sdp": OFFER, "key": "untrusted"}, {"sdp": "v=0" + "x" * 70000}])
def test_invalid_offer(client, payload):
    assert client.post("/api/navigation/voice/session", json=payload, headers=ORIGIN).status_code == 422


def test_payload_limit_and_content_type(client):
    assert client.post("/api/navigation/voice/session", content="x" * 100001, headers={**ORIGIN, "Content-Type": "application/json"}).status_code == 413
    assert client.post("/api/navigation/voice/session", content=OFFER, headers=ORIGIN).status_code == 415


def test_valid_handshake_keeps_key_server_side(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "secret-test")
    monkeypatch.setenv("OPENAI_REALTIME_MODEL", "test-model")
    captured = {}

    def upstream(request, timeout):
        captured["auth"] = request.get_header("Authorization")
        assert request.full_url == "https://api.openai.com/v1/realtime/calls"
        assert timeout == 20
        message = BytesParser(policy=default).parsebytes(("Content-Type: " + request.get_header("Content-type") + "\r\n\r\n").encode() + request.data)
        parts = {part.get_param("name", header="content-disposition"): part.get_payload(decode=True).decode() for part in message.iter_parts()}
        assert parts["sdp"] == OFFER
        config = json.loads(parts["session"])
        assert config["model"] == "test-model"
        assert {tool["name"] for tool in config["tools"]} == {"search_places", "select_place", "get_current_location"}
        assert config["audio"]["input"]["transcription"]["language"] == "ko"
        return io.BytesIO(OFFER.encode())

    monkeypatch.setattr(voice, "urlopen", upstream)
    response = post(client)
    assert response.status_code == 200
    assert response.text == OFFER
    assert response.headers["content-type"].startswith("application/sdp")
    assert response.headers["cache-control"] == "no-store"
    assert captured["auth"] == "Bearer secret-test"
    assert "secret-test" not in response.text


@pytest.mark.parametrize("error,status,code", [
    (HTTPError("url", 401, "secret-test", {}, io.BytesIO(b"secret-test")), 503, "VOICE_AUTH_FAILED"),
    (HTTPError("url", 429, "secret-test", {}, io.BytesIO(b"secret-test")), 429, "VOICE_RATE_LIMIT"),
    (HTTPError("url", 400, "secret-test", {}, io.BytesIO(b"secret-test")), 502, "VOICE_UPSTREAM_ERROR"),
    (TimeoutError("secret-test"), 504, "VOICE_TIMEOUT"),
    (URLError("secret-test"), 502, "VOICE_UNAVAILABLE"),
])
def test_sanitized_upstream_errors(client, monkeypatch, error, status, code):
    monkeypatch.setenv("OPENAI_API_KEY", "secret-test")
    def upstream(*args, **kwargs):
        raise error
    monkeypatch.setattr(voice, "urlopen", upstream)
    response = post(client)
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert "secret-test" not in response.text


@pytest.mark.parametrize("answer", [b"not SDP", b"v=0\nm=audio " + b"x" * 70000, b"v=0\nm=audio \xff"])
def test_invalid_provider_answer(client, monkeypatch, answer):
    monkeypatch.setenv("OPENAI_API_KEY", "secret-test")
    monkeypatch.setattr(voice, "urlopen", lambda *args, **kwargs: io.BytesIO(answer))
    assert post(client).json()["detail"]["code"] == "VOICE_INVALID_RESPONSE"


def test_custom_origin(client, monkeypatch):
    monkeypatch.setenv("NAV_ALLOWED_ORIGINS", "https://demo.example")
    monkeypatch.setenv("OPENAI_API_KEY", "secret-test")
    monkeypatch.setattr(voice, "exchange_sdp", lambda *_: OFFER)
    response = client.post("/api/navigation/voice/session", json={"sdp": OFFER}, headers={"Origin": "https://demo.example"})
    assert response.status_code == 200
    assert post(client).status_code == 403

