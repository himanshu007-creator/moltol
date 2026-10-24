<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# MolTol — hard invariants for agents

These are non-negotiable. Break one and the hackathon submission is invalid.

1. **Money is integer cents.** Never floats. Every price is `amountCents: number` (integer) + `currency`. Use `packages/contracts` `MoneySchema`.
2. **Sealed limits never leak.** A side's private limit must never appear in an LLM prompt, a log line, an HTTP response to the other side, or an event with `audience: "all"`. Read/write limits only through `packages/store`'s sealed vault.
3. **The guard always disposes.** No price reaches the wire unless it passed `packages/policy` `validateOffer` for the acting side. If an LLM-proposed price fails the guard, fall back to the policy price and emit a `verdict` event with `ok: false`.
4. **PayPal POSTs are idempotent.** Every order create/capture includes a stable `PayPal-Request-Id`; webhook handlers dedupe by PayPal event id before doing anything.
5. **Event log is append-only and ordered.** `seq` is monotonic per negotiation; runner state is reconstructed from events so restarts resume rather than duplicate.
6. **Contracts are the source of truth.** Types shared with the frontend live in `packages/contracts`; change them there first, then conform the backend.
7. **Never commit secrets.** `.env`, tfstate/tfvars, and real keys are gitignored. `gitleaks` runs in CI.
8. **Verify before you claim done.** `pnpm build && pnpm typecheck && pnpm test && pnpm lint` must pass.

## Credentials — always confirm first

Before **any** action that uses real credentials — AWS (`aws`, `terraform apply`), GitHub (`gh`, `git push`), PayPal, SSH keys, npm tokens, or anything reading secrets from `.env`/`terraform.tfvars` — stop and ask the user to confirm, stating: which credential/profile, which account/target, and what the action will do. Read-only calls (`describe-*`, `git status`, `gh pr view`) don't need confirmation. Destructive or write actions (terminate, delete, release, apply, push, PR create, deploy) always do, even if previously approved in the same session.

## AWS account — moltol only

- **Always** `AWS_PROFILE=moltol` and region **`ap-southeast-2`** only (the account's SCP denies other regions).
- **Never** use the default/local `aws` profile or any other AWS account for anything moltol-related — instances, EIPs, IAM, S3, debugging. Create nothing outside the project account.
- Local `terraform.tfstate` may still reference a long-terminated instance — delete stale state before a fresh apply rather than trusting it.
- `infra/terraform/terraform.tfvars` holds secrets (PayPal sandbox, SEAL_KEY) and is gitignored — never commit, never paste into another account.
