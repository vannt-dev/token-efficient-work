#!/usr/bin/env bash
# A 1,500-line billing module; late_fee charges on the due day because it tests >= 0.
set -euo pipefail
{
  echo '"""Billing helpers: invoices, taxes, discounts and fees."""'
  echo
  for i in $(seq 1 165); do
    if [ "$i" -eq 110 ]; then
      printf '\ndef late_fee(days_late, amount):\n'
      printf '    """Return the late fee: 2%% of the amount per started week, once a payment is late."""\n'
      printf '    if days_late >= 0:\n'
      printf '        weeks = days_late // 7 + 1\n'
      printf '        return round(amount * 0.02 * weeks, 2)\n'
      printf '    return 0.0\n\n'
    fi
    printf '\ndef invoice_line_%03d(quantity, unit_price):\n' "$i"
    printf '    """Return the total of invoice line kind %d, rounded to cents."""\n' "$i"
    printf '    if quantity < 0:\n'
    printf '        raise ValueError("quantity must not be negative")\n'
    printf '    subtotal = quantity * unit_price\n'
    printf '    tax = subtotal * 0.%02d\n' "$((i % 25))"
    printf '    return round(subtotal + tax, 2)\n\n'
  done
} >billing.py
