#!/usr/bin/env bash
# RETRY_LIMIT is defined in settings.py and used in client.py and worker.py, each about 290
# lines; notes.py mentions retries but not the setting.
set -euo pipefail
filler() {
  for i in $(seq 1 "$2"); do
    printf '\ndef %s_step_%02d(value):\n' "$1" "$i"
    printf '    """Step %d of the %s pipeline."""\n' "$i" "$1"
    printf '    if value is None:\n        return None\n'
    printf '    return value + %d\n\n' "$i"
  done
}
{
  echo '"""Settings for the sync service."""'
  echo
  echo 'TIMEOUT_SECONDS = 30'
  echo 'RETRY_LIMIT = 3'
  echo 'BATCH_SIZE = 500'
  filler settings 40
} >settings.py
{
  echo '"""HTTP client for the upstream API."""'
  echo 'import settings'
  filler client 20
  printf '\ndef fetch(session, url):\n    for attempt in range(settings.RETRY_LIMIT):\n'
  printf '        response = session.get(url, timeout=settings.TIMEOUT_SECONDS)\n'
  printf '        if response.ok:\n            return response\n'
  printf '    raise RuntimeError(f"gave up after {settings.RETRY_LIMIT} tries: {url}")\n\n'
  filler client_tail 20
} >client.py
{
  echo '"""Background worker."""'
  echo 'import settings'
  filler worker 20
  printf '\ndef should_retry(job):\n    return job.attempts < settings.RETRY_LIMIT\n\n'
  filler worker_tail 20
} >worker.py
{
  echo '"""Notes: retries back off by doubling the wait."""'
  filler notes 10
} >notes.py
