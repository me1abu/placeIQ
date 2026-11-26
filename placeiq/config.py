"""Project-wide paths, constants and local settings for the PlaceIQ engine.

Layout of the placeiq-app folder:
    placeiq/         this Python package (engine + API service)
    web/             the Next.js interface (talks to this engine through its /api/engine proxy)
    placeiq-data/    institution data: companies.json, jds/, templates/, the SQLite database,
                     raw/processed/synthetic datasets and model artifacts (personal data git-ignored)

Settings come from environment variables, falling back to `.env` in the app folder.
`python -m placeiq init` adds PlaceIQ's entries to that file (appending, never overwriting),
so nothing external is needed.
"""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent          # the placeiq-app folder
ENV_PATH = ROOT / ".env"
load_dotenv(ENV_PATH, override=False)

PQ_DIR = Path(os.environ.get("PLACEIQ_DATA_DIR") or ROOT / "placeiq-data")
DATA_DIR = PQ_DIR
ARTIFACTS_DIR = PQ_DIR / "artifacts"
FIGURES_DIR = ARTIFACTS_DIR / "figures"
CONFIG_DIR = PQ_DIR
JD_DIR = PQ_DIR / "jds"
TAXONOMY_PATH = Path(__file__).resolve().parent / "extraction" / "taxonomy.json"
COMPANIES_PATH = PQ_DIR / "companies.json"

MODEL_PATH = ARTIFACTS_DIR / "model.joblib"
METRICS_PATH = ARTIFACTS_DIR / "metrics.json"

# The local API service the web app talks to (through its /api/engine proxy).
API_HOST = os.environ.get("PLACEIQ_API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("PLACEIQ_API_PORT", "8765"))

# Small hosting plans (e.g. Render free: ~0.1 CPU, 512 MB) can't retrain in time or memory.
# With this set, the deployed app serves the model built into the image; retrain locally and redeploy.
TRAINING_DISABLED = os.environ.get("PLACEIQ_DISABLE_TRAINING", "").strip().lower() in ("1", "true", "yes")

TARGET = "placed"
RANDOM_STATE = 42
CV_FOLDS = 5


def database_url() -> str:
    """SQLite file by default (zero install). Set DATABASE_URL for PostgreSQL, e.g.
    postgresql+psycopg://user:pass@localhost:5432/placeiq (needs `pip install psycopg[binary]`)."""
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        return f"sqlite:///{(PQ_DIR / 'placeiq.db').as_posix()}"
    # Hosted Postgres (Neon, Supabase, Render) hands out postgres:// or postgresql:// URLs;
    # point SQLAlchemy at the psycopg 3 driver that requirements-runtime.txt installs.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


# Secrets PlaceIQ needs, with how to make each one. start.bat passes .env to the web app too.
#   PLACEIQ_SALT            hashes roll numbers (changing it orphans shared profiles and accounts)
#   PLACEIQ_SESSION_SECRET  signs sign-in cookies (changing it signs everyone out)
#   PLACEIQ_ADMIN_PASSWORD  the placement-cell password (edit it in .env to choose your own)
_SECRETS = {
    "PLACEIQ_SALT": lambda: secrets.token_hex(32),
    "PLACEIQ_SESSION_SECRET": lambda: secrets.token_hex(32),
    "PLACEIQ_ADMIN_PASSWORD": lambda: secrets.token_urlsafe(9),
}


def ensure_env(web: bool = False) -> list[str]:
    """Add missing PlaceIQ secrets to .env (appending, never rewriting other entries) and return
    the names added. The engine itself needs only the salt; `web=True` (python -m placeiq init,
    run by start.bat) also adds the web app's session secret and placement-cell password, so
    other commands (e.g. the Docker build) never write those into a file."""
    load_dotenv(ENV_PATH, override=False)
    names = list(_SECRETS) if web else ["PLACEIQ_SALT"]
    missing = [k for k in names if not os.environ.get(k)]
    if not missing:
        return []
    fresh = not ENV_PATH.exists() or "--- PlaceIQ" not in ENV_PATH.read_text(encoding="utf-8")
    lines = ["", "# --- PlaceIQ (local secrets; never commit this file) ---"] if fresh else [""]
    lines += [f"{k}={_SECRETS[k]()}" for k in missing]
    if fresh:
        lines.append("# DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/placeiq")
    with ENV_PATH.open("a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    load_dotenv(ENV_PATH, override=True)
    return missing
