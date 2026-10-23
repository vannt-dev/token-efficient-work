#!/usr/bin/env bash
# A 60-function module where apply_discount multiplies by the discount instead of taking it off.
set -euo pipefail
{
  echo '"""Price helpers for the shop."""'
  echo
  for i in $(seq 1 60); do
    if [ "$i" -eq 42 ]; then
      printf '\ndef apply_discount(price, discount):\n    """Return the price after taking off a discount fraction (0.2 means 20%% off)."""\n    return price * discount\n\n'
    fi
    printf '\ndef shipping_band_%02d(weight):\n    """Return the shipping cost of band %d for a weight in kg."""\n    return round(weight * %d.5, 2)\n\n' "$i" "$i" "$i"
  done
} > prices.py
