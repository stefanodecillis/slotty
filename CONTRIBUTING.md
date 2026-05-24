# Contributing to Slotty

Thanks for considering a contribution. Slotty is a single-user, self-hosted app — keep changes focused and avoid feature creep.

## Quick start

```bash
bun install
cp .env.example .env
bun run key:generate --write     # writes SLOTTY_ENCRYPTION_KEY + SLOTTY_SESSION_SECRET into .env
bunx prisma migrate dev
bun run dev
```

## Standards

- **TypeScript strict** with `noUncheckedIndexedAccess`. No `any` without justification.
- **Conventional Commits** for commit messages: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- **Lint + typecheck must pass** before opening a PR. Run:
  ```bash
  bun run lint && bun run typecheck && bun test
  ```
- **No emoji in code or comments.**
- **Small PRs.** One logical change per PR.
- **Secret scan.** `bun install` wires `.githooks/pre-commit` to run [gitleaks](https://github.com/gitleaks/gitleaks) on the staged diff. Install it once: `brew install gitleaks` (macOS) or grab a binary from the releases page. CI runs the same scan on every PR regardless.

## Architecture

See `docs/` and the per-phase READMEs. The hot paths are documented inline:

- `src/lib/scheduling/compute.ts` — slot computation algorithm
- `src/lib/sync/` — Google Calendar sync engine
- `src/lib/booking/create.ts` — booking idempotency + race guard

## Tests

- Unit tests: `bun test`
- Integration tests (Google API mocked): `bun test tests/integration`
- E2E (Playwright): `bun run test:e2e`

## License

By contributing you agree your contributions are licensed under AGPL-3.0-or-later, the same license as the project.
