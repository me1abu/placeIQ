"""Local persistence (SQLAlchemy). SQLite by default; PostgreSQL via DATABASE_URL.

Tables
- student_records: profiles students chose to share with the placement cell (consented),
  keyed by a salted hash of the roll number. No names, emails, phones or resume text.
- student_accounts: student sign-ins (roll-number hash + password hash).
- annotations: the hand-labelled resumes for the extraction study (§4.3). Text is stored
  with contact details stripped so the evaluation can be re-run when the extractor changes;
  delete the set once the study is reported.
"""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint, create_engine
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
