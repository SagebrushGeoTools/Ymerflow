"""Standalone refresher subprocess for credential_strategy="short-lived" jobs.

Forked by runner.py (via storage_credentials_client.spawn_refresher) right after the initial
credential mint, before process_class.run() is invoked. Runs for the lifetime of the job: sleeps
until roughly half the current credential's remaining lifetime, re-mints via the backend's
internal refresh endpoint, and writes the result to CREDENTIALS_FILE for the main process to pick
up on its next storage access (storage_credentials_client.RefreshableStorageKwargs).

See docs/plans/done/short-lived-storage-credentials-04-runner-refresh-loop.md section 4.3/4.4.
"""
import os
import random
import sys
import time
from datetime import datetime, timezone

import requests

from storage_credentials_client import write_credentials_atomic

MIN_SLEEP_SECONDS = 30
MAX_BACKOFF_SECONDS = 300
JITTER_FRACTION = 0.1


def log(message):
    print(f"[storage-credential-refresher] {message}", file=sys.stderr, flush=True)


def parse_iso(ts):
    if not ts:
        return None
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def compute_sleep_seconds(expires_at):
    """Half the remaining lifetime, jittered, with a floor — a hard floor keeps a very
    short-lived credential (or a clock-skewed expires_at) from causing a refresh busy-loop, and
    jitter keeps many long jobs launched around the same time from refreshing in lockstep."""
    if expires_at is None:
        base = MIN_SLEEP_SECONDS
    else:
        remaining = (expires_at - datetime.now(timezone.utc)).total_seconds()
        base = max(MIN_SLEEP_SECONDS, remaining / 2)
    jitter = base * JITTER_FRACTION
    return base + random.uniform(-jitter, jitter)


def refresh_once(backend_url, process_id, version, refresh_token):
    resp = requests.post(
        f"{backend_url}/internal/process/{process_id}/versions/{version}/storage-credentials/refresh",
        headers={"X-Storage-Refresh-Token": refresh_token},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def main():
    backend_url = os.environ["BACKEND_URL"]
    process_id = os.environ["PROCESS_ID"]
    version = os.environ["VERSION"]
    refresh_token = os.environ["STORAGE_REFRESH_TOKEN"]

    expires_at = parse_iso(os.environ.get("STORAGE_CREDENTIALS_EXPIRES_AT"))
    backoff = MIN_SLEEP_SECONDS

    while True:
        sleep_seconds = compute_sleep_seconds(expires_at)
        log(f"sleeping {sleep_seconds:.0f}s before next refresh")
        time.sleep(sleep_seconds)

        try:
            result = refresh_once(backend_url, process_id, version, refresh_token)
        except Exception as e:
            # A rolling backend restart or a transient network blip must not fail a long-running
            # job outright — keep retrying with backoff, and only give up (by writing an error
            # sentinel) once the *current* credential is actually past its own expiry.
            log(f"refresh failed: {e}")
            if expires_at is not None and datetime.now(timezone.utc) >= expires_at:
                write_credentials_atomic({"error": str(e)})
                log("current credential has expired and refresh is still failing — wrote error sentinel")
            backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            time.sleep(backoff)
            continue

        backoff = MIN_SLEEP_SECONDS
        expires_at = parse_iso(result.get("expires_at"))
        write_credentials_atomic({"credentials": result["credentials"], "expires_at": result.get("expires_at")})
        log(f"refreshed, expires_at={result.get('expires_at')}")


if __name__ == "__main__":
    main()
