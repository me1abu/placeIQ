"""Placement cell Applicants (job board, step 4): list, status updates, CV download, CSV export."""
import csv
import io
import json
from datetime import date

import pytest
from fastapi.testclient import TestClient

YEAR = date.today().year + 1
JOB = {"company": "Acme Tech", "title": "Junior Python Developer",
       "description": "Python, SQL, Pandas, Git and REST APIs for internal data tools.",
       "skills": ["python", "sql", "pandas", "git", "rest api"], "min_cgpa": 6.5, "max_backlogs": 0}
PROFILE = {"branch": "CSE", "cgpa": 7.4, "active_backlogs": 0, "internships": 1, "projects": 2,
           "certifications": 1, "skills": ["python", "sql", "git", "pandas"]}


@pytest.fixture()
def client(monkeypatch, tmp_path):
    from placeiq.api import main
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'a.db').as_posix()}")
    monkeypatch.setenv("PLACEIQ_SALT", "test-salt")
    return TestClient(main.app)


def _student(client, roll):
    return client.post("/api/auth/register", json={"roll_number": roll, "password": "password1"}).json()["student_hash"]


def _apply(client, job_id, roll, skills, name="Test Student", cv=None):
    h = _student(client, roll)
    data = {"name": name, "email": f"{roll.lower()}@example.com", "phone": "+91 98765 43210", "roll_number": roll,
            "batch_year": YEAR, "consent": True, "profile": {**PROFILE, "skills": skills}}
    files = {"cv": ("my cv.pdf", cv, "application/pdf")} if cv else None
    r = client.post(f"/api/jobs/{job_id}/apply", data={"data": json.dumps(data)}, files=files,
                    headers={"x-placeiq-student": h})
    assert r.status_code == 200, r.text
    return h


def test_applicants_flow(client):
    job = client.post("/api/admin/jobs", json=JOB).json()
    assert client.get("/api/admin/jobs").json()[0]["applicants"] == {}
    _apply(client, job["id"], "R00001", ["python"])                                      # 20%
    me = _apply(client, job["id"], "R00002", ["python", "sql", "git", "pandas"], cv=b"%PDF-1.4 cv")  # 80%
    _apply(client, job["id"], "R00003", ["python", "sql"], name="=HYPERLINK(\"x\")")     # 40%

    out = client.get(f"/api/admin/jobs/{job['id']}/applications").json()
    apps = out["applications"]
    assert out["job"]["title"] == JOB["title"]
    assert [a["roll_number"] for a in apps] == ["R00002", "R00003", "R00001"]           # best match first
    top = apps[0]
    assert top["match_score"] == 0.8 and top["missing"] == ["rest api"] and top["has_cv"] is True
    assert "cv_data" not in top and apps[2]["has_cv"] is False

    # status update shows in the job list counts and on the student's My applications
    assert client.put(f"/api/admin/applications/{top['id']}/status", json={"status": "shortlisted"}).json()["status"] == "shortlisted"
    assert client.put(f"/api/admin/applications/{top['id']}/status", json={"status": "hired"}).status_code == 422
    assert client.put("/api/admin/applications/999/status", json={"status": "selected"}).status_code == 404
    assert client.get("/api/admin/jobs").json()[0]["applicants"] == {"applied": 2, "shortlisted": 1}
    mine = client.post("/api/jobs/mine", json={}, headers={"x-placeiq-student": me}).json()
    assert mine["applications"][0]["status"] == "shortlisted"

    # CV download
    r = client.get(f"/api/admin/applications/{top['id']}/cv")
    assert r.status_code == 200 and r.content == b"%PDF-1.4 cv" and r.headers["content-type"] == "application/pdf"
    assert 'filename="R00002_my_cv.pdf"' in r.headers["content-disposition"]
    assert client.get(f"/api/admin/applications/{apps[2]['id']}/cv").status_code == 404

    # CSV export, with formula-looking text neutralised
    r = client.get(f"/api/admin/jobs/{job['id']}/applications/export")
    assert "applicants_Acme_Tech_Junior_Python_Developer.csv" in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert [row["roll_number"] for row in rows] == ["R00002", "R00003", "R00001"]
    assert rows[0]["skill_match_pct"] == "80" and rows[0]["status"] == "shortlisted" and rows[0]["cv_attached"] == "yes"
    assert rows[1]["name"].startswith("'=")


def test_unknown_job(client):
    assert client.get("/api/admin/jobs/42/applications").status_code == 404
    assert client.get("/api/admin/jobs/42/applications/export").status_code == 404
