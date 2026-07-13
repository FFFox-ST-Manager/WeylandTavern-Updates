# Weyland-LTM — Changes since v1.3.3 (→ v1.5.2)

Read-first summary for the backend team. Full technical detail on each item is in `README.md`; this is the "what changed and why" changelog.

---

## 0. Hotfix (v1.5.2): Merge silently did nothing

**Symptom reported:** select two LTMs, hit Merge — button lights up (enabled), but clicking it does nothing at all. No error, no toast, no new draft.

**Root cause:** `buildMergePrompt()` referenced `${user}` inside its system-message template literal but never declared it — unlike `buildLTMPrompt()`, which does `const user = getUserName();`. Clicking Merge threw a `ReferenceError` the instant the template literal was evaluated, which happens synchronously as an argument to `createJob(...)` inside `onMergeClicked` — an `async` function with no try/catch. The throw happened before anything else in the handler ran (no toast, no job, no sidebar update), so the failure was completely invisible from the UI: an unhandled promise rejection, console-only.

The exact same bug existed in `buildRewritePrompt()` — the path used when rerolling a **legacy** or **merged** entry (no known `sourceRange` to regenerate from). That would have failed identically and just as silently.

**Fix:**
- Added the missing `const user = getUserName();` to both `buildMergePrompt()` and `buildRewritePrompt()`.
- Wrapped `onMergeClicked()` in try/catch with a `toast('error', ...)`, matching the pattern already used by `onSaveClicked`/`onDeleteClicked`/`onPinToggleClicked` — a future throw in this path will now surface instead of failing as a dead click.

---

## 1. Fixed: duplicate/re-summarized LTMs after a page reload

**Symptom reported:** saved an LTM at message 50, saved a second one at message 100, and the second one re-summarized the *entire* chat from message 0 — including ground the first LTM already covered.

**Root cause:** `saveDraftState()` only ever persisted `{text, savedAt}` for an unsaved draft. If the panel was closed and later reopened (e.g. after a page reload), the restore path (`openPanel`) rebuilt the job from scratch via `computeRangeFromCurrentChat()` and — critically — **without** `isFreshSummary: true`. The save handler only advances the coverage cursor (`__chatState[chatId].lastLtmMessageId`) when `isFreshSummary` is set, so saving a restored draft looked like it worked but silently never moved the cursor. The next "+ New LTM" started from message 0 again.

**Fix:**
- `saveDraftState()` now persists the job's `range`, `sourceRangeForSave`, and `isFreshSummary` alongside the text, and the restore path rebuilds the job with those intact.
- `recordLTMCoverage()` is now keyed by the **job's** `chatId`, not whatever chat happens to be open at save time (the UX explicitly encourages chatting elsewhere while a draft generates, so "current chat at save" was never a safe assumption).
- Drafts are also now saved under the *job's* chat id when the panel closes (was `getCurrentChatId()`).
- A startup sweep (`sweepStaleDrafts()`) discards any persisted draft older than 14 days, cleaning up orphaned entries from before this fix.

## 2. New: "Messages summarized per LTM" setting

New field in LTM Settings, `summarizeSpan` (default: blank/0 = **Auto**, which matches the existing cadence setting — identical to old behavior). Set it to a specific number to make every LTM cover a fixed number of messages regardless of the suggestion cadence. It only ever overrides the *size cap*, never the "skip what a previous memory already covered" start point.

## 3. Changed: "Time for an LTM?" chip → orange brain button

The floating suggestion chip is gone — it was easy to miss on desktop and ate real estate on mobile. The 🧠 brain quick-reply button itself now glows orange (`.wlm-brain-due` class, pulsing amber) when a memory is due, applied via `applyBrainDue()` and re-asserted by a `MutationObserver` on `#qr--bar` since the QR bar's own re-renders wipe DOM classes. The transient generating/ready/failed chips are unchanged (still the right call — they're actionable and short-lived).

## 4. New: Auto-LTM (Off / Semi-Auto / Full-Auto)

New setting `autoLtmMode`, one dropdown so the modes are naturally mutually exclusive. **Off by default.**

- **Off** (default) — unchanged manual flow.
- **Semi-Auto** — the moment the cadence cap is hit, a draft generates in the background automatically. It is **not** saved automatically — the brain keeps glowing (instead of the usual "draft ready" chip) until the user opens the panel and approves it themselves.
- **Full-Auto** — same background generation, but it saves itself the instant it passes validation, with zero manual step. The brain never glows in this mode; the only feedback is the existing transient "🧠 LTM generating…" chip.

**Drafts stack.** This was the one non-obvious design point: Semi-Auto drafts are meant to accumulate if ignored. Hitting cadence 50 at message 50, then again at message 100 without approving the first, produces **two** separate pending drafts (0–50 and 50–100) — not one. This required a second, independent coverage cursor (`lastAutoDraftMessageId`, tracked alongside but separately from the saved-coverage `lastLtmMessageId`), because "has anything been saved" is the wrong question for "has an auto-draft already claimed this span." `recordLTMCoverage()` (fired on manual save) was updated to explicitly preserve this cursor through its otherwise-wholesale `__chatState` overwrite, so saving one stacked draft out of order can't reset the cursor and cause a later still-pending segment to get silently re-summarized.

The only thing that blocks a new auto-trigger is an in-flight generation for that chat — segments are always produced one at a time. If the cursor is still behind after one finishes, the completion handler re-checks and queues the next, so a long absence cascades through several correctly-sized drafts instead of one giant dump or a lost gap.

Auto-trigger only evaluates the chat currently being viewed (same scope limitation the old suggestion-chip logic always had) — it won't generate anything for a chat you're not actively in.

**Rerolling a stacked/semi-auto draft** already worked correctly for free: job-kind reroll (`onRerollClicked`) reuses `job.range` unchanged, so even coming back 300 messages later, rerolling always regenerates from the *original* span, never a grown one — matching what Lucky specifically asked for.

---

## Files changed

- `index.js` — all logic above; version bumped `1.3.3 → 1.5.1`.
- `style.css` — chip CSS trimmed (dropped `[data-kind="suggest"]`), added `.wlm-brain-due` glow/pulse rules.
- `manifest.json` — version bump to match.
- `README.md` — backend-facing technical notes updated for all four items above.
- `USER_GUIDE.md` — user-facing wording updated (see the separate plain-language summary for the actual copy).
