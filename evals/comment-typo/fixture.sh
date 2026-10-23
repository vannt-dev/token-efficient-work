#!/usr/bin/env bash
# A mail module with a typo in one comment, and a test file the agent does not need to run.
set -euo pipefail
{
  echo '"""Outgoing mail."""'
  echo
  for i in $(seq 1 40); do
    if [ "$i" -eq 25 ]; then
      printf '\n# Users who opted in recieve a copy of every message.\ndef send_mail(to, body, copy_to=None):\n    recipients = [to] + ([copy_to] if copy_to else [])\n    return {"to": recipients, "body": body}\n\n'
    fi
    printf '\ndef template_%02d(name):\n    return "Template %d for " + name\n\n' "$i" "$i"
  done
} > mailer.py
printf 'from mailer import send_mail\n\n\ndef test_copy():\n    assert send_mail("a", "b", "c")["to"] == ["a", "c"]\n' > test_mailer.py
