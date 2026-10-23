#!/usr/bin/env bash
# A 60-function module and its one caller; calc_total sits in the middle of the module.
set -euo pipefail
{
  echo '"""Small numeric helpers."""'
  echo
  for i in $(seq 1 60); do
    if [ "$i" -eq 31 ]; then
      printf '\ndef calc_total(items):\n    """Sum the price of every item."""\n    return sum(item["price"] for item in items)\n\n'
    fi
    printf '\ndef helper_%02d(x):\n    """Return x scaled by %d."""\n    return x * %d\n\n' "$i" "$i" "$i"
  done
} >utils.py
printf 'from utils import calc_total\n\nprint(calc_total([{"price": 2}, {"price": 3}]))\n' >main.py
