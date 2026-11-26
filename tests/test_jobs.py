"""Jobs the placement cell posts (job board, step 1)."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(monkeypatch, tmp_path):
    from placeiq.api import main
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'j.db').as_posix()}")
    monkeypatch.setenv("PLACEIQ_SALT", "test-salt")
    return TestClient(main.app)


JOB = {"company": "Acme Tech", "title": "Junior Python Developer", "location": "Bengaluru",
       "job_type": "full_time", "salary": "₹4–6 LPA",
       "description": "Looking for a fresher with Python, SQL and Git to build internal data tools.",
       "skills": ["Python", "sql", "git"], "min_cgpa": 6.5, "max_backlogs": 0,
       "branches": ["cse", "IT"], "batch_years": [date.today().year + 1]}


def test_create_list_update_delete(client):
    r = client.post("/api/admin/jobs", json=JOB)
    assert r.status_code == 200, r.text
    job = r.json()
    assert job["skills"] == ["git", "python", "sql"]          # normalised to taxonomy names
    assert job["branches"] == ["CSE", "IT"]
    assert job["status"] == "open" and job["accepting"] is True and job["deadline"] is None

    later = client.post("/api/admin/jobs", json={**JOB, "title": "ML Intern", "job_type": "internship"}).json()
    listed = client.get("/api/admin/jobs").json()
    assert [j["id"] for j in listed] == [later["id"], job["id"]]  # newest first

    past = (date.today() - timedelta(days=1)).isoformat()
    r = client.put(f"/api/admin/jobs/{job['id']}", json={**JOB, "deadline": past})
    assert r.json()["accepting"] is False                      # deadline passed
    r = client.put(f"/api/admin/jobs/{job['id']}", json={**JOB, "status": "closed"})
    assert r.json()["status"] == "closed" and r.json()["accepting"] is False
    assert client.get("/api/admin/jobs").json()[-1]["id"] == job["id"]  # closed jobs listed last

    assert client.delete(f"/api/admin/jobs/{job['id']}").json()["deleted"]
    assert client.delete(f"/api/admin/jobs/{job['id']}").status_code == 404
    assert client.put("/api/admin/jobs/9999", json=JOB).status_code == 404


@pytest.mark.parametrize("bad", [
    {"skills": []},
    {"skills": ["basket weaving"]},
    {"branches": ["MBA"]},
    {"min_cgpa": 11},
    {"max_backlogs": -1},
    {"job_type": "part_time"},
    {"title": "x"},
    {"description": "short"},
    {"batch_years": [1990]},
])
def test_rejects_invalid_jobs(client, bad):
    assert client.post("/api/admin/jobs", json={**JOB, **bad}).status_code == 422
