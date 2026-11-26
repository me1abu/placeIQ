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
from datetime import timezone

import pandas as pd
from fastapi import APIRouter, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from placeiq import config
from placeiq.accounts import MIN_PASSWORD, burn_time, hash_password, verify_password
from placeiq.api.schemas import (AnnotationIn, CohortRequest, Credentials, CvText, Profile, RollNumber, ScoreRequest,
                                 StudentKey, StudentSave)
from placeiq.cohort import primary_gaps, summarize
from placeiq.data.anonymize import hash_identifier, strip_contact_info
from placeiq.db import Annotation, StudentAccount, StudentRecord, _now, get_session
from placeiq.eligibility.filter import eligible_companies, load_companies
from placeiq.explain.guidance import load_bundle, report
from placeiq.explain.whatif import score, suggestions
from placeiq.extraction import evaluate as extraction_eval
from placeiq.extraction.pdf_text import extract_text
from placeiq.extraction.profile import draft_profile
from placeiq.extraction.skills import extract_skill_matches, load_taxonomy
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
