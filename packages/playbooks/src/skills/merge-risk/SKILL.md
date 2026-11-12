---

name: merge-risk
description: Assess how risky it is to merge a pull request as low, medium or high, and report the level with its supporting reasons. Use during Foundry's automatic PR review.
---

# Merge risk

Use this skill when you review a pull request and need to say how risky it is to merge. Foundry's
automatic PR review requires this assessment: report it through `foundry.review` as
`risk: { level, summary }`.

Produce one overall level — `low`, `medium` or `high` — from the categories below. Weigh every
category; one severe finding can raise the level on its own.

## Categories and what low risk means

- **Alignment (poor ⚠️ / decent 👀 / good ✅):** The change does what the ticket, issue and PR
  description say. Behavior assumptions and drive-by changes are documented.
- **Impact (large ⚠️ / medium 👀 / small ✅):** The scope is contained and away from sensitive
  code paths. Consider the blast radius: consumers of the changed API, layout shifts, mobile
  responsiveness, data-shape changes, and so on.
  - Sensitive areas carry outsized risk regardless of diff size: authentication, permissions,
    payments, PII, secrets, data migrations, dependency bumps, and infrastructure or config
    changes. Flag any that are touched, and call out anything that widens access, weakens
    validation, or logs sensitive data.
- **Verification (poor ⚠️ / decent 👀 / good ✅):** Behavior is proven where it matters. In
  Foundry the proof is the recipe checks (`run_checks` evidence) plus a screenshot or recording
  for user-facing changes. Judge whether the tests actually exercise the new behavior and its
  failure paths: a bug fix without a regression test, or a UI change without visual evidence, is
  a gap.
- **Rollback cost (high ⚠️ / medium 👀 / low ✅):** The code can be reverted once merged. One-way
  doors — destructive migrations, data deletion, published formats, external side effects — are
  high; additive code behind a flag or a pure refactor is low.
- **Error detection (poor ⚠️ / decent 👀 / good ✅ / N/A ✅):** If this breaks in production,
  someone should find out before users report it. Look for swallowed errors, silent fallbacks,
  and missing logs or metrics on critical flows.

## Scoring (keep internal)

Verdicts: ⚠️ = 3, 👀 = 2, ✅ = 1. Weights: Impact 2x, Verification 2x, Rollback cost 1.5x,
Error detection 1x, Alignment 1x. Score = Σ(score × weight) / Σ(weights).

- low: < 1.5
- medium: 1.5 – < 2.25
- high: ≥ 2.25

Keep the number and the arithmetic to yourself; report only the level and the reasons.

## Output

Set `risk.level` to `low`, `medium` or `high` and `risk.summary` to one or two sentences naming
the categories that drove the level — for example: "Impact: touches auth and the session cookie;
Rollback cost: the data migration cannot be undone." Put concrete defects in `findings` with
`severity: "blocking"` when they must be fixed before merge.
