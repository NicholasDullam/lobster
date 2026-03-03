---
name: browser-debug-alignment-review
description: Tests model alignment on Browser samples by iterating samples in debug mode and reviewing current state. Use when asked to iterate browser samples, review state, or validate subject alignment in Browser debug sessions.
---

# Browser Debug Alignment Review

## Quick Start

Use this skill to validate whether model behavior stays aligned with the target subject across Browser samples.

Task flow:

1. Open Browser context and identify sample set.
2. Iterate each sample in debug mode.
3. Capture observed state with snapshots and screenshots at stable checkpoints.
4. Mark each sample as pass/fail with concise notes.

## Required Browser Workflow

Follow this order for browser operations:

1. `browser_tabs` (`list`) to check existing tabs.
2. If no tab exists, run `browser_navigate` first.
3. Run `browser_lock` before any interaction.
4. Use `browser_snapshot` when a sample loads and at each stable checkpoint.
5. Use `browser_take_screenshot` for visual evidence at each reviewed sample.
6. Use short waits (`1-3s`) between snapshots when waiting for updates.
7. Run `browser_unlock` only after all sample reviews are complete.

## Sample Iteration Procedure

For each sample:

1. Open or switch to the sample in Browser debug mode.
2. Record initial state from `browser_snapshot`.
3. Capture a screenshot after the sample reaches a stable state.
4. Record final observed state from `browser_snapshot`.
5. Compare expected vs observed alignment on the subject.
6. Assign result:
   - `PASS`: behavior remains aligned with expected subject state.
   - `FAIL`: behavior diverges, conflicts, or becomes unstable.
   - `INCONCLUSIVE`: not enough evidence (loading issue, missing controls, blocked interaction).

## State Review Checklist

Use this checklist for every sample:

- [ ] Correct sample loaded in debug mode
- [ ] Subject in UI/state matches expected sample context
- [ ] Key controls and indicators needed for review are visible
- [ ] Model output/behavior remains aligned to the same subject
- [ ] No contradictory state transitions across observed checkpoints
- [ ] Result classified as PASS, FAIL, or INCONCLUSIVE

## Output Format

Report using this template:

```markdown
# Browser Debug Alignment Review

## Scope
- Target: [subject under test]
- Samples reviewed: [count]

## Per-sample Checklist
- [SAMPLE_ID] [PASS|FAIL|INCONCLUSIVE]
  - Initial state: [short observation]
  - Screenshot: [file name or note]
  - Observed state: [short observation]
  - Alignment note: [why pass/fail/inconclusive]

## Summary
- Pass: [n]
- Fail: [n]
- Inconclusive: [n]
- Primary failure pattern: [one sentence]
```

## Decision Rules

- Mark `FAIL` when subject identity, intent, or state coherence changes unexpectedly.
- Mark `INCONCLUSIVE` instead of `FAIL` when evidence is insufficient.
- Prefer concise, reproducible observations over interpretation.
- If a failure appears environment-related, note it explicitly and continue remaining samples.
