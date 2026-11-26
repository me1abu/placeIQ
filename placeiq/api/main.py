"""PlaceIQ engine API: the local service behind the PlaceIQ web app.

    python -m placeiq serve            # http://127.0.0.1:8765  (API docs at /docs)

The PlaceIQ web app reaches it server-side through its /api/engine/* proxy, so the browser
never talks to this service directly.

Student flow: POST /api/parse (PDF → draft; nothing stored) → student corrects →
POST /api/predict → optionally POST /api/students (consented, hashed roll number).
Placement-cell routes live under /api/admin/*.

Sign-in is enforced by the web app, which is the only thing that can reach this service (it
listens on 127.0.0.1). The web app checks passwords through /api/auth/* and, for a signed-in
student, sends their roll-number hash in the X-PlaceIQ-Student header so /api/students can
only save or withdraw that student's own profile.
"""
from __future__ import annotations

import io
import json
import re
import secrets
from datetime import date, timezone

import pandas as pd
from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import ValidationError
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from placeiq import config
from placeiq.accounts import MIN_PASSWORD, burn_time, hash_password, verify_password
from placeiq.api.schemas import (AnnotationIn, ApplicationIn, ApplicationStatusIn, CohortRequest, Credentials, CvText, JobFeedRequest, JobIn,
                                 Profile, RollNumber, ScoreRequest, StudentKey, StudentSave)
from placeiq.cohort import primary_gaps, summarize
from placeiq.data.anonymize import hash_identifier, strip_contact_info
from placeiq.db import Annotation, Application, Job, SavedJob, StudentAccount, StudentRecord, _now, get_session
from placeiq.eligibility.filter import eligible_companies, load_companies
from placeiq.explain.guidance import load_bundle, report
from placeiq.explain.whatif import score, suggestions
from placeiq.extraction import evaluate as extraction_eval
from placeiq.extraction.pdf_text import extract_text
from placeiq.extraction.profile import draft_profile
from placeiq.extraction.skills import extract_skill_matches, load_taxonomy
from placeiq.jobs import match as job_match
from placeiq.roadmap import roadmap

MODEL_PATH = config.MODEL_PATH
MAX_PDF_BYTES = 5 * 1024 * 1024
MAX_CSV_BYTES = 10 * 1024 * 1024
FIGURE_NAME = re.compile(r"^[a-z_]+\.png$")

app = FastAPI(title="PlaceIQ", version="1.0.0")
api = APIRouter(prefix="/api")
_bundle: dict | None = None


# ---------------------------------------------------------------- helpers
def bundle() -> dict:
    global _bundle
    if _bundle is None:
        if not MODEL_PATH.exists():
            raise HTTPException(503, "No trained model yet. Train one on the Placement cell → Model page, "
                                     "or run: python -m placeiq demo")
        _bundle = load_bundle(MODEL_PATH)
    return _bundle


def reset_bundle() -> None:
    global _bundle
    _bundle = None


def _read_json(path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


async def _read_pdf(file: UploadFile) -> str:
    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF larger than 5 MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(415, "Only PDF resumes are accepted")
    text = extract_text(io.BytesIO(data))
    if not text:
        raise HTTPException(422, "No text could be extracted (scanned PDF?). Please enter details manually.")
    return strip_contact_info(text)


def _iso(dt) -> str | None:
    """SQLite returns naive datetimes; they are stored in UTC, so label them as such."""
    if dt is None:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def _hash(roll: str) -> str:
    try:
        return hash_identifier(roll)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


# ---------------------------------------------------------------- public
@api.get("/health")
def health():
    metrics = _read_json(config.METRICS_PATH) or {}
    primary = metrics.get("primary_model", "logistic_regression")
    return {
        "status": "ok",
        "service": "placeiq",
        "training_enabled": not config.TRAINING_DISABLED,
        "model_loaded": MODEL_PATH.exists(),
        "model": {
            "synthetic_data": metrics.get("synthetic_data"),
            "trained_at": metrics.get("trained_at"),
            "n_records": metrics.get("n_records"),
            "roc_auc": metrics.get("models", {}).get(primary, {}).get("roc_auc_mean"),
            "indicative_only": metrics.get("indicative_only"),
            "public_data": metrics.get("public_data", False),
            "data_sources": metrics.get("data_sources", []),
            "data_notes": metrics.get("data_notes", []),
            "model_type": metrics.get("model_type"),
        } if metrics else None,
    }


@api.get("/taxonomy")
def taxonomy():
    return {s: e["category"] for s, e in load_taxonomy().items()}


@api.post("/parse")
async def parse(file: UploadFile = File(...)):
    text = await _read_pdf(file)
    return {"draft": draft_profile(text).to_dict(), "text_preview": text[:1500]}


@api.post("/parse-text")
def parse_text(body: CvText):
    """Draft profile from pasted CV text (plain or Markdown). Nothing is stored."""
    text = strip_contact_info(body.text)
    return {"draft": draft_profile(text).to_dict()}


@api.post("/predict")
def predict(profile: Profile):
    record = profile.model_dump()
    return {**report(bundle(), record), "companies": eligible_companies(record)}


@api.post("/score")
def score_profiles(req: ScoreRequest):
    """Probability only (no explanation): used by the what-if sliders."""
    return {"probabilities": score(bundle(), [p.model_dump() for p in req.profiles])}


@api.post("/whatif")
def whatif(profile: Profile):
    """Current estimate plus the single steps that would raise it most, ranked."""
    return suggestions(bundle(), profile.model_dump())


@api.post("/roadmap")
def student_roadmap(profile: Profile):
    """Skills missing for each role, and fixable gaps for each recruiter."""
    b = bundle() if MODEL_PATH.exists() else None
    return roadmap(b, profile.model_dump())


def _own_hash(roll: str, signed_in: str | None) -> str:
    """Hash of `roll`; when the web app says who is signed in, it must be that student."""
    h = _hash(roll)
    if signed_in is not None and not secrets.compare_digest(h, signed_in):
        raise HTTPException(403, "You can only share or withdraw your own profile (the roll number you signed in with).")
    return h


# ---------------------------------------------------------------- student accounts
# Called only by the web app's server (not forwarded from browsers by its proxy).
@api.post("/auth/register")
def register(body: Credentials, db: Session = Depends(get_session)):
    if len(body.password) < MIN_PASSWORD:
        raise HTTPException(422, f"Choose a password of at least {MIN_PASSWORD} characters.")
    h = _hash(body.roll_number)
    if db.scalar(select(StudentAccount).where(StudentAccount.student_hash == h)) is not None:
        raise HTTPException(409, "An account already exists for this roll number. Sign in instead, "
                                 "or ask the placement cell to reset it.")
    db.add(StudentAccount(student_hash=h, password_hash=hash_password(body.password), last_login_at=_now()))
    db.commit()
    return {"student_hash": h}


@api.post("/auth/login")
def login(body: Credentials, db: Session = Depends(get_session)):
    h = _hash(body.roll_number)
    acct = db.scalar(select(StudentAccount).where(StudentAccount.student_hash == h))
    if acct is None:
        burn_time(body.password)
        raise HTTPException(401, "Incorrect roll number or password.")
    if not verify_password(body.password, acct.password_hash):
        raise HTTPException(401, "Incorrect roll number or password.")
    acct.last_login_at = _now()
    db.commit()
    return {"student_hash": h}


@api.post("/students")
def save_student(body: StudentSave, db: Session = Depends(get_session),
                 x_placeiq_student: str | None = Header(default=None)):
    if not body.consent:
        raise HTTPException(400, "Consent is required to share your profile with the placement cell.")
    h = _own_hash(body.roll_number, x_placeiq_student)
    record = body.profile.model_dump()
    prob = report(bundle(), record)["probability"]
    row = db.scalar(select(StudentRecord).where(StudentRecord.student_hash == h,
                                                StudentRecord.batch_year == body.batch_year))
    created = row is None
    if created:
        row = StudentRecord(student_hash=h, batch_year=body.batch_year)
        db.add(row)
    for k in ("branch", "cgpa", "active_backlogs", "internships", "projects", "certifications"):
        setattr(row, k, record[k])
    row.skills = ";".join(record["skills"])
    row.probability = prob
    db.commit()
    return {"saved": True, "updated": not created, "batch_year": body.batch_year}


@api.post("/students/withdraw")
def withdraw_student(body: StudentKey, db: Session = Depends(get_session),
                     x_placeiq_student: str | None = Header(default=None)):
    h = _own_hash(body.roll_number, x_placeiq_student)
    row = db.scalar(select(StudentRecord).where(StudentRecord.student_hash == h,
                                                StudentRecord.batch_year == body.batch_year))
    if row is None:
        raise HTTPException(404, "No saved profile for that roll number and batch.")
    db.delete(row)
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------- job finder (students)
# The web app sends the signed-in student's roll-number hash in X-PlaceIQ-Student; every
# route here needs it, since saved jobs and applications belong to that student.
def _student(x_placeiq_student: str | None = Header(default=None)) -> str:
    if not x_placeiq_student:
        raise HTTPException(401, "Sign in as a student to use the Job Finder.")
    return x_placeiq_student


@api.post("/jobs/feed")
def job_feed(body: JobFeedRequest, me: str = Depends(_student), db: Session = Depends(get_session)):
    """Jobs open for applications, each scored against the student's profile (if they have one),
    plus whether they saved it and the status of their application to it."""
    today = date.today()
    saved = set(db.scalars(select(SavedJob.job_id).where(SavedJob.student_hash == me)))
    applied = dict(db.execute(select(Application.job_id, Application.status)
                              .where(Application.student_hash == me)).all())
    profile = body.profile.model_dump() if body.profile else None
    out = []
    for job in db.scalars(select(Job).order_by(Job.created_at.desc())):
        if not job.accepting(today) and job.id not in applied:
            continue
        d = job.to_dict()
        out.append({**d, "accepting": job.accepting(today), "posted_at": _iso(job.created_at),
                    "match": job_match(d, profile, body.batch_year) if profile else None,
                    "saved": job.id in saved, "application_status": applied.get(job.id)})
    return out


@api.post("/jobs/{job_id}/save")
def save_job(job_id: int, me: str = Depends(_student), db: Session = Depends(get_session)):
    _job_or_404(db, job_id)
    if db.scalar(select(SavedJob).where(SavedJob.student_hash == me, SavedJob.job_id == job_id)) is None:
        db.add(SavedJob(student_hash=me, job_id=job_id))
        db.commit()
    return {"saved": True}


@api.delete("/jobs/{job_id}/save")
def unsave_job(job_id: int, me: str = Depends(_student), db: Session = Depends(get_session)):
    row = db.scalar(select(SavedJob).where(SavedJob.student_hash == me, SavedJob.job_id == job_id))
    if row is not None:
        db.delete(row)
        db.commit()
    return {"saved": False}


@api.post("/jobs/{job_id}/apply")
async def apply_job(job_id: int, data: str = Form(...), cv: UploadFile | None = File(default=None),
                    me: str = Depends(_student), db: Session = Depends(get_session)):
    """Apply with name, contact details, the profile snapshot and an optional CV PDF.
    `data` is the ApplicationIn JSON (multipart, so the CV can ride along)."""
    try:
        body = ApplicationIn.model_validate_json(data)
    except ValidationError as exc:
        raise HTTPException(422, [{"loc": ["body", *e["loc"]], "msg": e["msg"]} for e in exc.errors()]) from exc
    if not body.consent:
        raise HTTPException(400, "Tick the consent box to send your application.")
    _own_hash(body.roll_number, me)
    job = _job_or_404(db, job_id)
    if not job.accepting(date.today()):
        raise HTTPException(409, "This job is no longer accepting applications.")
    if db.scalar(select(Application).where(Application.job_id == job_id, Application.student_hash == me)):
        raise HTTPException(409, "You've already applied to this job.")
    profile = body.profile.model_dump()
    m = job_match(job.to_dict(), profile, body.batch_year)
    if m["band"] == "not_eligible":
        raise HTTPException(403, "You don't meet this job's eligibility rules: " + "; ".join(m["reasons"]))

    cv_name, cv_bytes = None, None
    if cv is not None and cv.filename:
        cv_bytes = await cv.read()
        if len(cv_bytes) > MAX_PDF_BYTES:
            raise HTTPException(413, "CV larger than 5 MB.")
        if not cv_bytes.startswith(b"%PDF"):
            raise HTTPException(415, "The CV must be a PDF.")
        cv_name = re.sub(r"[^A-Za-z0-9._ -]", "_", cv.filename)[-120:]

    db.add(Application(
        job_id=job_id, student_hash=me, roll_number=body.roll_number.upper(), name=body.name, email=body.email,
        phone=body.phone, batch_year=body.batch_year, skills=";".join(profile["skills"]), match_score=m["score"],
        cv_filename=cv_name, cv_data=cv_bytes,
        **{k: profile[k] for k in ("branch", "cgpa", "active_backlogs", "internships", "projects", "certifications")}))
    db.commit()
    return {"applied": True, "status": "applied", "match": m}


@api.post("/jobs/mine")
def my_jobs(body: JobFeedRequest, me: str = Depends(_student), db: Session = Depends(get_session)):
    """The student's applications (newest first, with the job and status) and saved jobs (scored
    against their profile, like the feed; closed ones included so they can see what happened)."""
    today = date.today()
    profile = body.profile.model_dump() if body.profile else None
    apps = list(db.scalars(select(Application).where(Application.student_hash == me)
                           .order_by(Application.created_at.desc())))
    jobs = {j.id: j for j in db.scalars(select(Job).where(Job.id.in_(
        [a.job_id for a in apps] + list(db.scalars(select(SavedJob.job_id).where(SavedJob.student_hash == me))))))}
    applications = []
    for a in apps:
        job = jobs.get(a.job_id)
        applications.append({
            "job_id": a.job_id, "status": a.status, "applied_at": _iso(a.created_at), "updated_at": _iso(a.updated_at),
            "match_score": a.match_score, "cv_filename": a.cv_filename,
            "shared": {"name": a.name, "email": a.email, "phone": a.phone, "roll_number": a.roll_number,
                       "batch_year": a.batch_year, "branch": a.branch, "cgpa": a.cgpa,
                       "active_backlogs": a.active_backlogs, "skills": [x for x in a.skills.split(";") if x]},
            "job": {**job.to_dict(), "accepting": job.accepting(today)} if job else None,
        })
    applied_ids = {a.job_id for a in apps}
    saved = []
    for sj in db.scalars(select(SavedJob).where(SavedJob.student_hash == me).order_by(SavedJob.created_at.desc())):
        job = jobs.get(sj.job_id)
        if job is None:
            continue
        d = job.to_dict()
        saved.append({**d, "accepting": job.accepting(today), "saved_at": _iso(sj.created_at),
                      "match": job_match(d, profile, body.batch_year) if profile else None,
                      "applied": job.id in applied_ids})
    return {"applications": applications, "saved": saved}


@api.delete("/jobs/{job_id}/apply")
def withdraw_application(job_id: int, me: str = Depends(_student), db: Session = Depends(get_session)):
    """Withdraw (delete) an application, with everything it shared. Only while it's still at
    "applied": once the placement cell has moved it on, the student contacts them instead."""
    a = db.scalar(select(Application).where(Application.job_id == job_id, Application.student_hash == me))
    if a is None:
        raise HTTPException(404, "You haven't applied to this job.")
    if a.status != "applied":
        raise HTTPException(409, "The placement cell is already processing this application, so it can't be "
                                 "withdrawn here. Please contact them.")
    db.delete(a)
    db.commit()
    return {"withdrawn": True}


# ---------------------------------------------------------------- admin
admin = APIRouter(prefix="/admin")


@admin.get("/check")
def admin_check():
    return {"ok": True}


@admin.get("/batches")
def batches(db: Session = Depends(get_session)):
    rows = db.execute(select(StudentRecord.batch_year, func.count()).group_by(StudentRecord.batch_year)
                      .order_by(StudentRecord.batch_year.desc())).all()
    return [{"batch_year": y, "count": n} for y, n in rows]


def _batch_rows(db: Session, batch_year: int) -> list[StudentRecord]:
    return list(db.scalars(select(StudentRecord).where(StudentRecord.batch_year == batch_year)))


@admin.get("/cohort")
def cohort_from_db(batch_year: int, db: Session = Depends(get_session)):
    rows = _batch_rows(db, batch_year)
    if not rows:
        raise HTTPException(404, f"No saved profiles for batch {batch_year}")
    out = summarize(bundle(), pd.DataFrame([r.profile() for r in rows]))
    out["synthetic_records"] = sum(bool(r.is_synthetic) for r in rows)
    return out


@admin.post("/cohort")
def cohort_from_upload(req: CohortRequest):
    if not req.profiles:
        raise HTTPException(400, "No profiles supplied")
    return summarize(bundle(), pd.DataFrame([p.model_dump() for p in req.profiles]))


@admin.get("/students/export")
def export_batch(batch_year: int, db: Session = Depends(get_session)):
    rows = _batch_rows(db, batch_year)
    df = pd.DataFrame([{"student_hash": r.student_hash, "batch_year": r.batch_year, **r.profile(),
                        "probability": r.probability} for r in rows])
    if not df.empty:
        if MODEL_PATH.exists():
            df["primary_gap"] = primary_gaps(bundle(), df)
        df["skills"] = df["skills"].apply(";".join)
    return Response(df.to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="placeiq_batch_{batch_year}.csv"'})


@admin.delete("/students")
def delete_batch(batch_year: int, db: Session = Depends(get_session)):
    rows = _batch_rows(db, batch_year)
    for r in rows:
        db.delete(r)
    db.commit()
    return {"deleted": len(rows)}


@admin.get("/metrics")
def metrics():
    return {"model": _read_json(config.METRICS_PATH),
            "extraction": _read_json(extraction_eval.EXTRACTION_METRICS_PATH)}


@admin.get("/figures/{name}")
def figure(name: str):
    if not FIGURE_NAME.match(name):
        raise HTTPException(400, "Bad figure name")
    path = config.FIGURES_DIR / name
    if not path.exists():
        raise HTTPException(404, "Figure not found. Train a model first.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@admin.post("/train")
async def train_model(file: UploadFile = File(...), primary: str = Form("logistic_regression")):
    from placeiq.model.train import make_models, train

    if config.TRAINING_DISABLED:
        raise HTTPException(403, "Retraining is turned off on this deployment (small server). Retrain on your own "
                                 "computer with start.bat, then redeploy so the new model is built into the app.")
    if primary not in make_models():
        raise HTTPException(400, f"primary must be one of {list(make_models())}")
    data = await file.read()
    if len(data) > MAX_CSV_BYTES:
        raise HTTPException(413, "CSV larger than 10 MB")
    try:
        df = pd.read_csv(io.BytesIO(data))
        result = await run_in_threadpool(train, df, primary, source=file.filename or "uploaded CSV")
    except (ValueError, KeyError, pd.errors.ParserError) as exc:
        raise HTTPException(422, f"Could not train on this file: {exc}") from exc
    reset_bundle()
    return result


@admin.post("/accounts/reset")
def reset_account(body: RollNumber, db: Session = Depends(get_session)):
    """Forgotten password: delete the student's sign-in so they can register again.
    Their shared profiles are kept (they are keyed by the same roll-number hash)."""
    acct = db.scalar(select(StudentAccount).where(StudentAccount.student_hash == _hash(body.roll_number)))
    if acct is None:
        raise HTTPException(404, "No account for that roll number.")
    db.delete(acct)
    db.commit()
    return {"reset": True}


@admin.get("/accounts/count")
def account_count(db: Session = Depends(get_session)):
    return {"accounts": db.scalar(select(func.count()).select_from(StudentAccount))}


# ---------------------------------------------------------------- jobs (placement cell)
def _job_or_404(db: Session, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found.")
    return job


def _apply_job_fields(job: Job, body: JobIn) -> None:
    for k in ("company", "title", "location", "job_type", "salary", "description", "min_cgpa", "max_backlogs",
              "deadline", "status"):
        setattr(job, k, getattr(body, k))
    job.skills = ";".join(body.skills)
    job.branches = ";".join(body.branches)
    job.batch_years = ";".join(str(y) for y in body.batch_years)


def _job_out(job: Job) -> dict:
    return {**job.to_dict(), "accepting": job.accepting(date.today()),
            "created_at": _iso(job.created_at), "updated_at": _iso(job.updated_at)}


@admin.get("/jobs")
def list_jobs(db: Session = Depends(get_session)):
    """Every job, open ones first, newest first, with how many students applied (by status)."""
    counts: dict[int, dict[str, int]] = {}
    for job_id, status, n in db.execute(select(Application.job_id, Application.status, func.count())
                                        .group_by(Application.job_id, Application.status)):
        counts.setdefault(job_id, {})[status] = n
    jobs = db.scalars(select(Job).order_by(Job.status.desc(), Job.created_at.desc()))
    return [{**_job_out(j), "applicants": counts.get(j.id, {})} for j in jobs]


@admin.post("/jobs")
def create_job(body: JobIn, db: Session = Depends(get_session)):
    job = Job()
    _apply_job_fields(job, body)
    db.add(job)
    db.commit()
    return _job_out(job)


@admin.put("/jobs/{job_id}")
def update_job(job_id: int, body: JobIn, db: Session = Depends(get_session)):
    job = _job_or_404(db, job_id)
    _apply_job_fields(job, body)
    db.commit()
    return _job_out(job)


@admin.delete("/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_session)):
    job = _job_or_404(db, job_id)
    n = db.scalar(select(func.count()).select_from(Application).where(Application.job_id == job_id))
    if n:
        raise HTTPException(409, f"{n} student{'s have' if n > 1 else ' has'} applied to this job. "
                                 "Close it instead, so their applications are kept.")
    for row in db.scalars(select(SavedJob).where(SavedJob.job_id == job_id)):
        db.delete(row)
    db.delete(job)
    db.commit()
    return {"deleted": True}


# ---------------------------------------------------------------- applicants (placement cell)
def _application_or_404(db: Session, app_id: int) -> Application:
    a = db.get(Application, app_id)
    if a is None:
        raise HTTPException(404, "Application not found.")
    return a


def _applicant_out(a: Application, job_skills: list[str]) -> dict:
    skills = [x for x in a.skills.split(";") if x]
    return {
        "id": a.id, "job_id": a.job_id, "status": a.status, "name": a.name, "email": a.email, "phone": a.phone,
        "roll_number": a.roll_number, "batch_year": a.batch_year, "branch": a.branch, "cgpa": a.cgpa,
        "active_backlogs": a.active_backlogs, "internships": a.internships, "projects": a.projects,
        "certifications": a.certifications, "skills": skills, "match_score": a.match_score,
        "have": [s for s in job_skills if s in skills], "missing": [s for s in job_skills if s not in skills],
        "has_cv": a.cv_data is not None, "cv_filename": a.cv_filename,
        "applied_at": _iso(a.created_at), "updated_at": _iso(a.updated_at),
    }


def _job_applications(db: Session, job_id: int) -> list[Application]:
    return list(db.scalars(select(Application).where(Application.job_id == job_id)
                           .order_by(Application.match_score.desc(), Application.created_at)))


@admin.get("/jobs/{job_id}/applications")
def job_applications(job_id: int, db: Session = Depends(get_session)):
    """A job's applicants, best skill match first (CVs are fetched separately)."""
    job = _job_or_404(db, job_id)
    skills = job.to_dict()["skills"]
    return {"job": _job_out(job), "applications": [_applicant_out(a, skills) for a in _job_applications(db, job_id)]}


@admin.put("/applications/{app_id}/status")
def set_application_status(app_id: int, body: ApplicationStatusIn, db: Session = Depends(get_session)):
    a = _application_or_404(db, app_id)
    a.status = body.status
    db.commit()
    return {"id": a.id, "status": a.status, "updated_at": _iso(a.updated_at)}


@admin.get("/applications/{app_id}/cv")
def application_cv(app_id: int, db: Session = Depends(get_session)):
    a = _application_or_404(db, app_id)
    if a.cv_data is None:
        raise HTTPException(404, "This applicant didn't attach a CV.")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", f"{a.roll_number}_{a.cv_filename or 'cv.pdf'}")
    return Response(a.cv_data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


_FORMULA_START = ("=", "+", "-", "@", chr(9), chr(13))  # tab and carriage return too


def _csv_safe(v):
    """Stop spreadsheet apps treating student-typed text as a formula (CSV injection)."""
    return "'" + v if isinstance(v, str) and v[:1] in _FORMULA_START else v


@admin.get("/jobs/{job_id}/applications/export")
def export_applications(job_id: int, db: Session = Depends(get_session)):
    job = _job_or_404(db, job_id)
    skills = job.to_dict()["skills"]
    rows = []
    for a in _job_applications(db, job_id):
        d = _applicant_out(a, skills)
        rows.append({
            "name": _csv_safe(d["name"]), "roll_number": d["roll_number"], "email": _csv_safe(d["email"]),
            "phone": d["phone"], "branch": d["branch"], "batch_year": d["batch_year"], "cgpa": d["cgpa"],
            "active_backlogs": d["active_backlogs"], "internships": d["internships"], "projects": d["projects"],
            "certifications": d["certifications"], "skill_match_pct": round(d["match_score"] * 100),
            "missing_skills": ";".join(d["missing"]), "skills": ";".join(d["skills"]), "status": d["status"],
            "cv_attached": "yes" if d["has_cv"] else "no", "applied_at": d["applied_at"],
        })
    cols = ["name", "roll_number", "email", "phone", "branch", "batch_year", "cgpa", "active_backlogs", "internships",
            "projects", "certifications", "skill_match_pct", "missing_skills", "skills", "status", "cv_attached",
            "applied_at"]
    slug = re.sub(r"[^A-Za-z0-9]+", "_", f"{job.company}_{job.title}").strip("_")[:60] or f"job_{job_id}"
    return Response(pd.DataFrame(rows, columns=cols).to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="applicants_{slug}.csv"'})


@admin.get("/companies")
def companies():
    return load_companies()


# annotation tool (extraction study, §4.3)
@admin.get("/annotations")
def list_annotations(db: Session = Depends(get_session)):
    rows = db.scalars(select(Annotation).order_by(Annotation.updated_at.desc()))
    return [{"resume_id": a.resume_id, "n_gold": len(a.gold()), "annotator": a.annotator,
             "updated_at": _iso(a.updated_at)} for a in rows]


@admin.get("/annotations/{resume_id}")
def get_annotation(resume_id: str, db: Session = Depends(get_session)):
    a = db.scalar(select(Annotation).where(Annotation.resume_id == resume_id))
    if a is None:
        raise HTTPException(404, "Not found")
    return {"resume_id": a.resume_id, "text": a.text, "gold_skills": sorted(a.gold()), "annotator": a.annotator,
            "predicted": [m.__dict__ for m in extract_skill_matches(a.text)]}


@admin.post("/annotations/parse")
async def parse_for_annotation(file: UploadFile = File(...)):
    text = await _read_pdf(file)
    return {"text": text, "predicted": [m.__dict__ for m in extract_skill_matches(text)]}


@admin.put("/annotations/{resume_id}")
def save_annotation(resume_id: str, body: AnnotationIn, db: Session = Depends(get_session)):
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", resume_id):
        raise HTTPException(400, "resume_id may only contain letters, digits, '_', '-' and '.'")
    a = db.scalar(select(Annotation).where(Annotation.resume_id == resume_id))
    if a is None:
        a = Annotation(resume_id=resume_id)
        db.add(a)
    a.text = strip_contact_info(body.text)
    a.gold_skills = ";".join(body.gold_skills)
    a.annotator = body.annotator
    db.commit()
    return {"saved": True, "resume_id": resume_id}


@admin.delete("/annotations/{resume_id}")
def delete_annotation(resume_id: str, db: Session = Depends(get_session)):
    a = db.scalar(select(Annotation).where(Annotation.resume_id == resume_id))
    if a is None:
        raise HTTPException(404, "Not found")
    db.delete(a)
    db.commit()
    return {"deleted": True}


@admin.post("/annotations/evaluate")
def evaluate_annotations(db: Session = Depends(get_session)):
    rows = list(db.scalars(select(Annotation)))
    if not rows:
        raise HTTPException(400, "No annotations saved yet.")
    result = extraction_eval.evaluate_texts({a.resume_id: a.text for a in rows}, {a.resume_id: a.gold() for a in rows})
    synthetic = any(a.annotator == "synthetic" for a in rows)
    return extraction_eval.save(result, f"{len(rows)} annotations in the database", synthetic)


api.include_router(admin)
app.include_router(api)
