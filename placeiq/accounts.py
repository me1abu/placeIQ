"""Student account passwords: PBKDF2-HMAC-SHA256 with a per-account random salt.

Stored as "pbkdf2_sha256$<iterations>$<salt hex>$<digest hex>" so the cost can be raised later
without breaking existing accounts.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets

ITERATIONS = 240_000
MIN_PASSWORD = 8


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)


# Spent on unknown roll numbers so a failed login takes as long whether or not the account exists.
_DUMMY = hash_password(secrets.token_hex(8))


def burn_time(password: str) -> None:
    verify_password(password, _DUMMY)
