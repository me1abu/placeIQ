from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from placeiq.extraction.skills import load_taxonomy


def _clean_skills(v: list[str]) -> list[str]:
    v = sorted({s.strip().lower() for s in v if s.strip()})
    unknown = [s for s in v if s not in load_taxonomy()]
    if unknown:
        raise ValueError(f"Not in taxonomy: {unknown}")
    return v


class Profile(BaseModel):
    """A student profile *after* the student has reviewed the parsed draft."""
    branch: str = Field(min_length=2, max_length=16)
    cgpa: float = Field(ge=0, le=10)
    active_backlogs: int = Field(ge=0, le=30)
    internships: int = Field(ge=0, le=20)
    projects: int = Field(ge=0, le=30)
    certifications: int = Field(ge=0, le=50)
    skills: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("branch")
    @classmethod
    def upper_branch(cls, v: str) -> str:
        return v.strip().upper()

    @field_validator("skills")
    @classmethod
    def skills_in_taxonomy(cls, v: list[str]) -> list[str]:
        return _clean_skills(v)


class CvText(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


class ScoreRequest(BaseModel):
    profiles: list[Profile] = Field(min_length=1, max_length=50)


class CohortRequest(BaseModel):
    profiles: list[Profile] = Field(max_length=5000)


class StudentKey(BaseModel):
    roll_number: str = Field(min_length=3, max_length=40)
    batch_year: int = Field(ge=2000, le=date.today().year + 6)


class RollNumber(BaseModel):
    roll_number: str = Field(min_length=3, max_length=40)


class Credentials(BaseModel):
    """Student sign-in / registration. Roll numbers are letters, digits and - / _ . only."""
    roll_number: str = Field(min_length=3, max_length=40, pattern=r"^\s*[A-Za-z0-9][A-Za-z0-9/_.\-]*\s*$")
    password: str = Field(min_length=1, max_length=200)


class StudentSave(StudentKey):
    consent: bool
    profile: Profile


BRANCH_CODES = ("CSE", "IT", "ECE", "EEE", "ME", "CIVIL")


class JobIn(BaseModel):
    """A job posted (or edited) by the placement cell."""
    company: str = Field(min_length=2, max_length=80)
    title: str = Field(min_length=2, max_length=100)
    location: str = Field(default="", max_length=80)
    job_type: Literal["full_time", "internship"] = "full_time"
    salary: str = Field(default="", max_length=60)
    description: str = Field(min_length=10, max_length=5000)
    skills: list[str] = Field(min_length=1, max_length=40)
    min_cgpa: float = Field(default=0, ge=0, le=10)
    max_backlogs: int | None = Field(default=None, ge=0, le=30)
    branches: list[str] = Field(default_factory=list, max_length=len(BRANCH_CODES))
    batch_years: list[int] = Field(default_factory=list, max_length=6)
    deadline: date | None = None
    status: Literal["open", "closed"] = "open"

    @field_validator("company", "title", "location", "salary", "description")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("skills")
    @classmethod
    def skills_in_taxonomy(cls, v: list[str]) -> list[str]:
        v = _clean_skills(v)
        if not v:
            raise ValueError("Add at least one required skill.")
        return v

    @field_validator("branches")
    @classmethod
    def known_branches(cls, v: list[str]) -> list[str]:
        v = sorted({b.strip().upper() for b in v if b.strip()})
        bad = [b for b in v if b not in BRANCH_CODES]
        if bad:
            raise ValueError(f"Unknown branch: {bad}. Use {list(BRANCH_CODES)}.")
        return v

    @field_validator("batch_years")
    @classmethod
    def sane_years(cls, v: list[int]) -> list[int]:
        this = date.today().year
        bad = [y for y in v if not this - 2 <= y <= this + 6]
        if bad:
            raise ValueError(f"Batch year out of range: {bad}")
        return sorted(set(v))


class JobFeedRequest(BaseModel):
    """The student's saved profile (it lives in their browser), used to score each job."""
    profile: Profile | None = None
    batch_year: int | None = Field(default=None, ge=2000, le=date.today().year + 6)


class ApplicationIn(BaseModel):
    """What a student submits when applying (with their consent)."""
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str = Field(pattern=r"^\+?[0-9][0-9 \-]{8,18}[0-9]$")
    roll_number: str = Field(min_length=3, max_length=40)
    batch_year: int | None = Field(default=None, ge=2000, le=date.today().year + 6)
    consent: bool
    profile: Profile

    @field_validator("name", "email", "phone", "roll_number", mode="before")
    @classmethod
    def strip(cls, v):
        return v.strip() if isinstance(v, str) else v


class ApplicationStatusIn(BaseModel):
    status: Literal["applied", "shortlisted", "interview", "selected", "rejected"]


class AnnotationIn(BaseModel):
    text: str = Field(min_length=20, max_length=50_000)
    gold_skills: list[str] = Field(default_factory=list, max_length=300)
    annotator: str = Field(default="", max_length=32)

    @field_validator("gold_skills")
    @classmethod
    def gold_in_taxonomy(cls, v: list[str]) -> list[str]:
        return _clean_skills(v)
