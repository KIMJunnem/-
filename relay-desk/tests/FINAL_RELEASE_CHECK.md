# 2026-09-16 internal verification — chat 0.2.30

Verified with an isolated server (8879), not production customer records:

- All nine suites passed: reply, new-scenarios-10, new-scenarios-15,
  full-order-simulation, intent-routing, duplicate-guard, safety-guards,
  selector-guard, consent-regressions.
- Selector suite was rerun after the last change and passed all eight groups.
- Old payment-request success text cannot acknowledge a new failed request.
- Same-day time selection does not fall back to elapsed or disabled times.
- Customer statements alone cannot establish platform hire/payment status.
- Payment status needs matching amount and a timestamp after the request;
  later cancellation/refund prevents using an older paid status.
- Questions/negative final-file acknowledgements cannot trigger billing.
- Normal auto replies use the checked send path; uncertain sends are held
  instead of being marked sent or retried automatically.

Limits: DOM tests use fixtures. The system-status selectors and timestamps
must still be verified on real Soomgo hire/payment cards; unknown structure
holds automation. No actual customer payment, file delivery or hire was tested.
The full-order simulation stores supplied TXT examples; it is not proof that
AI fulfillment and browser file delivery work end to end. Calendar submission
and real customer artifact quality also remain outside this verification.
This report does not certify unattended end-to-end commercial operation.
