# health-tracker

Personal food and exercise tracker, built as a training ground. The user is growing toward an L4 (stretch: L5) software engineer.

## Priorities (in order)

1. **The user learns** to L4/L5 standard: system design, enterprise-style planning, DevOps.
2. **The app works** and the user actually uses it daily from their phone.
3. **Efficient Claude Code usage.**

When 1 and 2 conflict, slow down and teach. Never trade understanding for speed silently.

## Product in one paragraph

From a mobile website, the user logs a meal or strength exercise through a structured form (food, quantity, unit; exercise, sets, reps, weight). The client sends that structured data to the server, which validates it. Later the user queries it: "all exercises today", "all food on 2026-11-03".

## Hard constraints

- **Portable infra.** First target: local VMs via Vagrant. Later: AWS, Azure, or others with no service code changes. Keep services cloud-agnostic: config comes from env vars, no provider SDKs in service code, and provider specifics live only in IaC.
- **Monorepo, nested layout.** Services live in `services/<svc>/` and own their `src/`, `k8s/`, and `Dockerfile`; platform infra (`iac/`, `k8s/`) lives at the root. Services share only the generated OpenAPI contract, never code. See `docs/adr/0003-monorepo-layout.md`.

## Teaching framework

The user does not write code but must understand everything they look at. Follow this loop for every non-trivial change.

**Before (the "why")**
- One or two sentences: what you are about to do and what problem it solves.
- If this is a design choice, name the main alternative and the tradeoff that decided it. One alternative, not a survey.

**During (the "what")**
- Work in small, reviewable steps. One concept per step where possible.
- The first time a term, tool, or pattern appears, define it in one line and add it to `docs/learning/terms.md`.
- Never wave something off as "boilerplate" or "standard config". If it is in the repo, explain once what each part does.

**After (the "recap")**
- **What changed:** 2-4 bullets.
- **Read this:** the 1-3 most important `file:line` spots to open, and what to notice there.
- **Senior lens:** one thing an L5 would ask about this change (failure modes, scaling, security, cost, observability, operability).
- **Check:** one short question to test understanding. The user may skip it.

**User shortcuts**

| User says | Agent does |
| --- | --- |
| `deeper` | Go one level further into the last concept, with an example |
| `skip` | Drop the teaching for this step, just do it |
| `quiz me` | 3 questions on what was just built, then review the answers |
| `why not X?` | Compare X to the chosen approach honestly. Say so if X is better |
| `in prod?` | Explain how this would differ at a real company at scale |

**Calibration**: Assume solid general programming knowledge. Assume little prior exposure to infra, containers, Kubernetes, IaC, or distributed systems. Adjust when the user shows they already know something.

## Enterprise practices used here

- **Planning before building.** Large efforts run through the `wayfinder` skill: a map issue plus decision tickets. Do not start building while the relevant decisions are still open.
- **ADRs.** Every significant decision gets an Architecture Decision Record in `docs/adr/NNNN-title.md` (context, decision, alternatives, consequences).
- **Two glossaries.** `GLOSSARY.md` (root) holds domain language only (Meal Entry, Set), no technology. `docs/learning/terms.md` holds tech terms defined while teaching, one line each.
- **Small PRs** with a description that explains the why, even though the user is the only reviewer.
- **Tests and lint pass** before calling anything done. Fix flaky tests and lint failures when found, even if unrelated.

## Working agreements for agents

- Read the relevant ADRs before changing an area they cover.
- Prefer boring, well-documented tools over clever ones. Their docs and community answers help the user learn.
- If the user's plan has a flaw, say so directly and explain why. Agreeing to keep things moving defeats priority 1.
