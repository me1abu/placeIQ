"""Student accounts (sign-in) and the own-profile check on /api/students."""
import pytest
from fastapi.testclient import TestClient

from placeiq.accounts import hash_password, verify_password


@pytest.fixture()
def client(monkeypatch, tmp_path):
    from placeiq.api import main
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'a.db').as_posix()}")
    monkeypatch.setenv("PLACEIQ_SALT", "test-salt")
    return TestClient(main.app)


def test_password_hashing():
    h = hash_password("correct horse")
    assert h.startswith("pbkdf2_sha256$") and "correct horse" not in h
    assert verify_password("correct horse", h)
    assert not verify_password("wrong", h)
    assert not verify_password("x", "garbage")
    assert hash_password("same") != hash_password("same")  # per-account salt


def test_register_login_reset(client):
    creds = {"roll_number": "02314802723", "password": "s3cret-pass"}
    r = client.post("/api/auth/register", json=creds)
    assert r.status_code == 200, r.text
    h = r.json()["student_hash"]
    assert client.post("/api/auth/register", json=creds).status_code == 409
    assert client.post("/api/auth/register", json={"roll_number": "R2", "password": "short"}).status_code == 422
    assert client.post("/api/auth/register", json={"roll_number": "a b<c>", "password": "longenough"}).status_code == 422

    assert client.post("/api/auth/login", json=creds).json()["student_hash"] == h
    # roll numbers are case/space-insensitive
    assert client.post("/api/auth/login", json={**creds, "roll_number": " 02314802723 "}).json()["student_hash"] == h
    assert client.post("/api/auth/login", json={**creds, "password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"roll_number": "UNKNOWN1", "password": "whatever"}).status_code == 401

    assert client.get("/api/admin/accounts/count").json() == {"accounts": 1}
    assert client.post("/api/admin/accounts/reset", json={"roll_number": "02314802723"}).json()["reset"]
    assert client.post("/api/auth/login", json=creds).status_code == 401
    assert client.post("/api/admin/accounts/reset", json={"roll_number": "02314802723"}).status_code == 404


def test_students_only_touch_their_own_profile(client):
    me = client.post("/api/auth/register", json={"roll_number": "R00001", "password": "password1"}).json()["student_hash"]
    key = {"roll_number": "R00002", "batch_year": 2026}
    # Signed in as R00001, trying to withdraw R00002's profile.
    r = client.post("/api/students/withdraw", json=key, headers={"x-placeiq-student": me})
    assert r.status_code == 403
    r = client.post("/api/students/withdraw", json={**key, "roll_number": "r00001"}, headers={"x-placeiq-student": me})
    assert r.status_code == 404  # allowed (own roll number); nothing saved yet
