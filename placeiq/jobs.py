"""How well a student matches a job the placement cell posted (job board).

The match has two parts:

1. Eligibility rules (pass/fail): minimum CGPA, maximum active backlogs, allowed branches and
   graduating batches. Failing any rule makes the student "not_eligible", and they can't apply.
2. Skill match: the share of the job's required skills the student has (0-1).

Bands for students who pass every rule:
    eligible      skill match >= 70%
    almost        40-69%
    stretch       below 40% (they can still apply)

This is a match score, not a probability of being hired: the project's own baseline experiment
(§4.6) is about how weakly resume/JD similarity predicts placement, so it is never shown as one.
"""
from __future__ import annotations

ELIGIBLE_AT = 0.70
ALMOST_AT = 0.40


def rule_failures(job: dict, profile: dict, batch_year: int | None) -> list[str]:
    """Plain-language reasons the student fails the job's rules (empty = passes all)."""
    reasons = []
    if job.get("min_cgpa") and profile["cgpa"] < job["min_cgpa"]:
        reasons.append(f"Needs CGPA {job['min_cgpa']:g}+ (you have {profile['cgpa']:g})")
    max_b = job.get("max_backlogs")
    if max_b is not None and profile["active_backlogs"] > max_b:
        allowed = "no active backlogs" if max_b == 0 else f"at most {max_b} active backlogs"
        reasons.append(f"Needs {allowed} (you have {profile['active_backlogs']})")
    if job.get("branches") and profile["branch"].upper() not in job["branches"]:
        reasons.append(f"Open to {', '.join(job['branches'])} only (you're {profile['branch'].upper()})")
    years = job.get("batch_years") or []
    if years:
        if batch_year is None:
            reasons.append(f"Open to batch {', '.join(map(str, years))}; set your batch on your profile")
        elif batch_year not in years:
            reasons.append(f"Open to batch {', '.join(map(str, years))} only (you're {batch_year})")
    return reasons


def match(job: dict, profile: dict, batch_year: int | None) -> dict:
    need = list(job.get("skills") or [])
    mine = {s.lower() for s in profile.get("skills", [])}
    have = [s for s in need if s in mine]
    missing = [s for s in need if s not in mine]
    score = len(have) / len(need) if need else 1.0
    reasons = rule_failures(job, profile, batch_year)
    if reasons:
        band = "not_eligible"
    elif score >= ELIGIBLE_AT:
        band = "eligible"
    elif score >= ALMOST_AT:
        band = "almost"
    else:
        band = "stretch"
    return {"score": round(score, 4), "band": band, "have": have, "missing": missing, "reasons": reasons}
