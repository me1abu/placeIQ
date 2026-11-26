"""Local persistence (SQLAlchemy). SQLite by default; PostgreSQL via DATABASE_URL.

Tables
- student_records: profiles students chose to share with the placement cell (consented),
  keyed by a salted hash of the roll number. No names, emails, phones or resume text.
- student_accounts: student sign-ins (roll-number hash + password hash).
- jobs: jobs and internships the placement cell posts for students to apply to.
- saved_jobs, applications: students' bookmarks and applications (applications hold the
  name, contact details and optional CV the student consented to share).
- annotations: the hand-labelled resumes for the extraction study (§4.3). Text is stored
  with contact details stripped so the evaluation can be re-run when the extractor changes;
  delete the set once the study is reported.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from functools import lru_cache

from sqlalchemy import (Boolean, Date, DateTime, Float, Integer, LargeBinary, String, Text, UniqueConstraint,
                        create_engine)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from placeiq.config import DATA_DIR, database_url


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class StudentRecord(Base):
    __tablename__ = "student_records"
    __table_args__ = (UniqueConstraint("student_hash", "batch_year"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_hash: Mapped[str] = mapped_column(String(64), index=True)
    batch_year: Mapped[int] = mapped_column(Integer, index=True)
    branch: Mapped[str] = mapped_column(String(16))
    cgpa: Mapped[float] = mapped_column(Float)
    active_backlogs: Mapped[int] = mapped_column(Integer)
    internships: Mapped[int] = mapped_column(Integer)
    projects: Mapped[int] = mapped_column(Integer)
    certifications: Mapped[int] = mapped_column(Integer)
    skills: Mapped[str] = mapped_column(Text, default="")
    probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def profile(self) -> dict:
        return {"branch": self.branch, "cgpa": self.cgpa, "active_backlogs": self.active_backlogs,
                "internships": self.internships, "projects": self.projects,
                "certifications": self.certifications,
                "skills": [s for s in self.skills.split(";") if s]}


class StudentAccount(Base):
    """A student's sign-in. Like student_records it is keyed by the salted roll-number hash,
    so the roll number itself is never stored; the password is kept only as a PBKDF2 hash."""
    __tablename__ = "student_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Job(Base):
    """A job or internship the placement cell posted for students to apply to.

    Lists are stored ';'-joined: skills (canonical taxonomy names), branches and batch_years
    (empty = open to all). max_backlogs None = no limit; deadline is the last day to apply."""
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    company: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(100))
    location: Mapped[str] = mapped_column(String(80), default="")
    job_type: Mapped[str] = mapped_column(String(16), default="full_time")
    salary: Mapped[str] = mapped_column(String(60), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    skills: Mapped[str] = mapped_column(Text, default="")
    min_cgpa: Mapped[float] = mapped_column(Float, default=0.0)
    max_backlogs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    branches: Mapped[str] = mapped_column(String(200), default="")
    batch_years: Mapped[str] = mapped_column(String(100), default="")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def to_dict(self) -> dict:
        split = lambda s: [x for x in (s or "").split(";") if x]  # noqa: E731
        return {
            "id": self.id, "company": self.company, "title": self.title, "location": self.location,
            "job_type": self.job_type, "salary": self.salary, "description": self.description,
            "skills": split(self.skills), "min_cgpa": self.min_cgpa, "max_backlogs": self.max_backlogs,
            "branches": split(self.branches), "batch_years": [int(y) for y in split(self.batch_years)],
            "deadline": self.deadline.isoformat() if self.deadline else None, "status": self.status,
        }

    def accepting(self, today: date) -> bool:
        """Open, and the deadline (if any) hasn't passed."""
        return self.status == "open" and (self.deadline is None or self.deadline >= today)


class SavedJob(Base):
    """A job a student bookmarked on the Job Finder."""
    __tablename__ = "saved_jobs"
    __table_args__ = (UniqueConstraint("student_hash", "job_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    student_hash: Mapped[str] = mapped_column(String(64), index=True)
    job_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


APPLICATION_STATUSES = ("applied", "shortlisted", "interview", "selected", "rejected")


class Application(Base):
    """A student's application to a job. Unlike the rest of PlaceIQ this holds identifying details
    (name, contact, roll number, optional CV), because a real application needs them; the student
    consents when applying, and withdrawing deletes the row. The profile is a snapshot taken at
    apply time, so later profile edits don't change what was submitted."""
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("job_id", "student_hash"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(Integer, index=True)
    student_hash: Mapped[str] = mapped_column(String(64), index=True)
    roll_number: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(20))
    batch_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    branch: Mapped[str] = mapped_column(String(16))
    cgpa: Mapped[float] = mapped_column(Float)
    active_backlogs: Mapped[int] = mapped_column(Integer)
    internships: Mapped[int] = mapped_column(Integer)
    projects: Mapped[int] = mapped_column(Integer)
    certifications: Mapped[int] = mapped_column(Integer)
    skills: Mapped[str] = mapped_column(Text, default="")
    match_score: Mapped[float] = mapped_column(Float)
    cv_filename: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cv_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="applied", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Annotation(Base):
    __tablename__ = "annotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    resume_id: Mapped[str] = mapped_column(String(64), unique=True)
    text: Mapped[str] = mapped_column(Text)
    gold_skills: Mapped[str] = mapped_column(Text, default="")
    annotator: Mapped[str] = mapped_column(String(32), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    def gold(self) -> set[str]:
        return {s for s in self.gold_skills.split(";") if s}


@lru_cache(maxsize=4)
def _engine(url: str):
    if url.startswith("sqlite"):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        engine = create_engine(url, connect_args={"check_same_thread": False})
    else:
        engine = create_engine(url, pool_pre_ping=True)
    Base.metadata.create_all(engine)
    return engine


def session_factory(url: str | None = None) -> sessionmaker[Session]:
    return sessionmaker(bind=_engine(url or database_url()), expire_on_commit=False)


def get_session():
    """FastAPI dependency."""
    with session_factory()() as s:
        yield s
