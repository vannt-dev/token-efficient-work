---
name: token-efficient-work
description: Use when about to read a file, re-check work you just finished, add a verification step nobody asked for, or write an explanation. Applies to any coding agent (Claude Code, Codex, Copilot CLI, Gemini CLI, or similar) at risk of burning tokens on redundant re-reads, whole-file reads for a small edit, unrequested double-checking, or over-long output.
---

# Token-Efficient Work

## Overview

Most wasted tokens don't come from the task itself — they come from the agent re-doing work it already did: re-reading a file it just edited, reading an entire file to change two lines, adding an extra "just to be safe" check the task never asked for, or writing a paragraph that restates what the diff already shows. None of this improves correctness. It just spends the user's budget.

**Core principle:** every read, re-check, and sentence of output should add information the agent doesn't already have. If it doesn't, skip it.

This does not mean skipping real verification. Actually running tests or confirming a claim before asserting "it works" is still required (see superpowers:verification-before-completion). This skill is about not layering *extra, unrequested* re-reads and checks on top of that — proportional verification, not zero verification.

## The Rules

**1. Locate before you read.** Don't open files hoping to find something. Search first (`grep`/`rg`, or the agent's search tool) to find the right file and line, then read only that region. Read a whole file only when you're about to edit a section whose surrounding logic you can't safely infer from a partial read — not as a default first move.

**2. A successful edit doesn't need a confirmation read.** If the edit/write tool reported success, the change applied — that's what "success" means. Re-reading the file afterward to "make sure" adds a full file's worth of tokens for zero new information. Only re-read if you need to see how the edit interacts with code you haven't viewed yet, or the user asked to see the result.

**3. Verify proportionally to what's at stake, not by reflex.** A one-line typo or comment fix doesn't need a full test run. A change to a shared function used elsewhere does. Before adding a check, name the specific risk it rules out; "can't hurt to check" is not a risk.

**4. Reuse what you already established.** If you read a file, ran a command, or checked a value earlier in this session, use that result. Don't re-fetch it "to be current" unless something specific suggests it changed (time passed in a long-running task, another process touched it, the user said they changed something).

**5. Match output length to the question.** A yes/no or single-fact question gets a sentence. Don't restate the task before doing it, narrate the plan step-by-step as you go, or close with a summary paragraph that repeats what the diff/output already shows. State the result, not the process.

## Quick Reference

| Need | Don't | Do |
|---|---|---|
| Find where something is defined/used | Open files one by one to look | `grep -rn "name" .` (or ripgrep), then read only the matching lines ± a few lines of context |
| See part of a large file | Read the whole file | `sed -n '120,160p' file`, or the agent's ranged-read (offset/limit), or `grep -B3 -A10` |
| Confirm an edit applied | Re-read the file | Trust the tool's success result; re-read only for new surrounding context you haven't seen |
| Decide whether to run tests | Run the full suite after every change | Run the narrowest relevant test for a real change; skip for cosmetic/no-behavior edits |
| Report what you did | Long closing summary | One line: what changed, what's next |

## Red Flags — you're about to waste tokens

- "Let me just double check that worked" right after a tool call already reported success
- Opening a file with no target line/section in mind
- Re-running a command you ran a few turns ago with no new reason to expect a different result
- Adding a build/lint/test run the task doesn't call for, to feel safer
- A closing paragraph that restates the diff or tool output in prose

All of these mean: stop, ask what new information this actually gives you, and skip it if the answer is none.

## Rationalization Table

| Excuse | Reality |
|---|---|
| "Let me verify that actually worked" (right after success) | The tool already told you. Re-reading confirms nothing new. |
| "I'll read the whole file for full context" | You need context for the section you're touching, not the file. Read the range; expand only if that's genuinely insufficient. |
| "One more check, just to be safe" | Safety isn't free. If you can't name the specific failure this check catches, it's cost with no signal. |
| "Let me re-read this to refresh my memory" | If nothing could have changed it since you read it, your memory of it is accurate. Re-reading adds no information. |
| "I should summarize everything I did" | The user can see the diff and tool calls. Restating them is narration, not new information. |

## Relationship to other verification guidance

This skill governs *how much unrequested extra work* surrounds a task — it does not license skipping real verification before claiming something is done. When the two seem to conflict: run the verification the completion claim actually needs (real), skip the verification that only exists to feel thorough (waste).
