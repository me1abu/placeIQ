"""Job Finder (job board, step 2): match scoring, feed, save and apply."""
import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from placeiq.jobs import match

YEAR = date.today().year + 1
PROFILE = {"branch": "CSE", "cgpa": 7.4, "active_backlogs": 0, "internships": 1, "projects": 2,
           "certifications": 1, "skills": ["python", "sql", "git", "pandas"]}
JOB = {"company": "Acme Tech", "title": "Junior Python Developer",
       "description": "Python, SQL, Pandas, Git and REST APIs for internal data tools.",
       "skills": ["python", "sql", "pandas", "git", "rest api"], "min_cgpa": 6.5, "max_backlogs": 0,
       "branches": ["CSE", "IT"], "batch_years": [YEAR]}


# ------------------------------------------------------------------ scoring
def test_match_bands():
    job = {**JOB}
    m = match(job, PROFILE, YEAR)
    assert m["band"] == "eligible" and m["score"] == 0.8
    assert m["have"] == ["python", "sql", "pandas", "git"] and m["missing"] == ["rest api"]
    assert match(job, {**PROFILE, "skills": ["python", "sql"]}, YEAR)["band"] == "almost"   # 40%
    assert match(job, {**PROFILE, "skills": ["python"]}, YEAR)["band"] == "stretch"         # 20%
    assert match(job, {**PROFILE, "skills": []}, YEAR)["score"] == 0


@pytest.mark.parametrize("change, batch, text", [
    ({"cgpa": 6.0}, YEAR, "CGPA 6.5+"),
    ({"active_backlogs": 1}, YEAR, "no active backlogs"),
    ({"branch": "ME"}, YEAR, "CSE, IT only"),
    ({}, YEAR + 1, f"batch {YEAR} only"),
    ({}, None, "set your batch"),
])
def test_rules_make_not_eligible(change, batch, text):
    m = match(JOB, {**PROFILE, **change}, batch)
    assert m["band"] == "not_eligible" and any(text in r for r in m["reasons"]), m["reasons"]


def test_open_rules_accept_everyone():
    open_job = {**JOB, "min_cgpa": 0, "max_backlogs": None, "branches": [], "batch_years": []}
    assert match(open_job, {**PROFILE, "cgpa": 5, "active_backlogs": 4, "branch": "CIVIL"}, None)["reasons"] == []


# ------------------------------------------------------------------ API
@pytest.fixture()
def client(monkeypatch, tmp_path):
    from placeiq.api import main
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'f.db').as_posix()}")
    monkeypatch.setenv("PLACEIQ_SALT", "test-salt")
    return TestClient(main.app)


@pytest.fixture()
def me(client):
    return client.post("/api/auth/register", json={"roll_number": "R00001", "password": "password1"}).json()["student_hash"]


def _post(client, **over):
    return client.post("/api/admin/jobs", json={**JOB, **over}).json()


def _apply(client, me, job_id, cv=None, **over):
    data = {"name": "Test Student", "email": "test@example.com", "phone": "+91 98765 43210",
            "roll_number": "R00001", "batch_year": YEAR, "consent": True, "profile": PROFILE, **over}
    files = {"cv": ("cv.pdf", cv, "application/pdf")} if cv is not None else None
    return client.post(f"/api/jobs/{job_id}/apply", data={"data": json.dumps(data)}, files=files,
                       headers={"x-placeiq-student": me})


def test_feed_needs_student(client):
    assert client.post("/api/jobs/feed", json={}).status_code == 401


def test_feed_scores_and_hides_closed(client, me):
    good = _post(client)
    _post(client, title="Closed one", status="closed")
    _post(client, title="Expired", deadline=(date.today() - timedelta(days=1)).isoformat())
    h = {"x-placeiq-student": me}
    feed = client.post("/api/jobs/feed", json={"profile": PROFILE, "batch_year": YEAR}, headers=h).json()
    assert [j["id"] for j in feed] == [good["id"]]
    assert feed[0]["match"]["band"] == "eligible" and feed[0]["saved"] is False and feed[0]["application_status"] is None
    no_profile = client.post("/api/jobs/feed", json={}, headers=h).json()
    assert no_profile[0]["match"] is None


def test_save_unsave(client, me):
    job = _post(client)
    h = {"x-placeiq-student": me}
    assert client.post(f"/api/jobs/{job['id']}/save", headers=h).json()["saved"]
    assert client.post(f"/api/jobs/{job['id']}/save", headers=h).json()["saved"]  # idempotent
    assert client.post("/api/jobs/feed", json={}, headers=h).json()[0]["saved"] is True
    assert client.delete(f"/api/jobs/{job['id']}/save", headers=h).json()["saved"] is False
    assert client.post("/api/jobs/999/save", headers=h).status_code == 404


def test_apply_flow(client, me):
    job = _post(client)
    r = _apply(client, me, job["id"], cv=b"%PDF-1.4 test")
    assert r.status_code == 200, r.text
    assert r.json()["match"]["score"] == 0.8
    assert _apply(client, me, job["id"]).status_code == 409                       # only once
    feed = client.post("/api/jobs/feed", json={}, headers={"x-placeiq-student": me}).json()
    assert feed[0]["application_status"] == "applied"

    # a closed job the student applied to still shows (with its status); others don't
    client.put(f"/api/admin/jobs/{job['id']}", json={**JOB, "status": "closed"})
    feed = client.post("/api/jobs/feed", json={}, headers={"x-placeiq-student": me}).json()
    assert feed and feed[0]["accepting"] is False
    # and the job can't be deleted while it has applications
    assert client.delete(f"/api/admin/jobs/{job['id']}").status_code == 409


def test_apply_rejections(client, me):
    job = _post(client)
    jid = job["id"]
    assert _apply(client, me, jid, consent=False).status_code == 400
    assert _apply(client, me, jid, roll_number="R00002").status_code == 403         # someone else's roll
    assert _apply(client, me, jid, profile={**PROFILE, "cgpa": 5.0}).status_code == 403  # fails a rule
    assert _apply(client, me, jid, email="not-an-email").status_code == 422
    assert _apply(client, me, jid, phone="12").status_code == 422
    assert _apply(client, me, jid, name="").status_code == 422
    assert _apply(client, me, jid, cv=b"not a pdf").status_code == 415
    assert _apply(client, me, jid, cv=b"%PDF" + b"0" * (5 * 1024 * 1024 + 1)).status_code == 413
    closed = _post(client, status="closed")
    assert _apply(client, me, closed["id"]).status_code == 409
    assert client.post(f"/api/jobs/{jid}/apply", data={"data": "{}"}).status_code == 401  # not signed in
    # none of the rejected attempts created an application
    assert _apply(client, me, jid).status_code == 200


def test_delete_job_clears_bookmarks(client, me):
    job = _post(client)
    client.post(f"/api/jobs/{job['id']}/save", headers={"x-placeiq-student": me})
    assert client.delete(f"/api/admin/jobs/{job['id']}").json()["deleted"]


# ------------------------------------------------------------------ My applications (step 3)
def _mine(client, me, profile=PROFILE):
    return client.post("/api/jobs/mine", json={"profile": profile, "batch_year": YEAR},
                       headers={"x-placeiq-student": me}).json()


def test_my_applications_and_saved(client, me):
    a = _post(client, title="Applied job")
    b = _post(client, title="Saved job", skills=["python", "docker"])
    h = {"x-placeiq-student": me}
    assert _mine(client, me) == {"applications": [], "saved": []}
    _apply(client, me, a["id"], cv=b"%PDF-1.4 x")
    client.post(f"/api/jobs/{b['id']}/save", headers=h)
    client.post(f"/api/jobs/{a['id']}/save", headers=h)

    mine = _mine(client, me)
    [app] = mine["applications"]
    assert app["job"]["title"] == "Applied job" and app["status"] == "applied" and app["match_score"] == 0.8
    assert app["cv_filename"] == "cv.pdf" and app["shared"]["email"] == "test@example.com"
    saved = {s["title"]: s for s in mine["saved"]}
    assert saved["Saved job"]["match"]["band"] == "almost" and saved["Saved job"]["applied"] is False
    assert saved["Applied job"]["applied"] is True

    # closing a saved job keeps it listed, marked as not accepting
    client.put(f"/api/admin/jobs/{b['id']}", json={**JOB, "title": "Saved job", "status": "closed"})
    assert {s["title"]: s["accepting"] for s in _mine(client, me)["saved"]}["Saved job"] is False

    # another student sees none of it
    other = client.post("/api/auth/register", json={"roll_number": "R00002", "password": "password2"}).json()["student_hash"]
    assert _mine(client, other) == {"applications": [], "saved": []}
    assert client.post("/api/jobs/mine", json={}).status_code == 401


def test_withdraw(client, me):
    from placeiq.db import Application, session_factory
    job = _post(client)
    h = {"x-placeiq-student": me}
    assert client.delete(f"/api/jobs/{job['id']}/apply", headers=h).status_code == 404
    _apply(client, me, job["id"])
    other = client.post("/api/auth/register", json={"roll_number": "R00002", "password": "password2"}).json()["student_hash"]
    assert client.delete(f"/api/jobs/{job['id']}/apply", headers={"x-placeiq-student": other}).status_code == 404
    assert client.delete(f"/api/jobs/{job['id']}/apply", headers=h).json()["withdrawn"]
    assert _mine(client, me)["applications"] == []
    assert _apply(client, me, job["id"]).status_code == 200            # can apply again after withdrawing

    # once the cell has moved it on, it can't be withdrawn here
    with session_factory()() as s:
        s.query(Application).update({"status": "shortlisted"})
        s.commit()
    assert client.delete(f"/api/jobs/{job['id']}/apply", headers=h).status_code == 409
    assert _mine(client, me)["applications"][0]["status"] == "shortlisted"
