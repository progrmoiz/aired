# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Setup and tests

- No `packageManager` field is pinned; `pnpm-lock.yaml` was generated with pnpm 10.x. Installing with a much newer pnpm (11+) silently drops the `pnpm.patchedDependencies` field from `package.json` (it wants that config in `pnpm-workspace.yaml` instead) and stops applying `patches/@joplin__htmlpack@3.5.1.patch` — use `pnpm@10` (e.g. `npx pnpm@10 install`) until the repo pins a version.
- `packages/core` must be built (`tsc -p packages/core`) before anything importing `@aired/core` — including tests — will resolve, since its `package.json` points at `dist/`.
- `apps/worker` has a vitest suite (`pnpm --filter @aired/worker test`); other packages have no tests yet. Root `pnpm test` runs `pnpm -r --if-present run test`.
- `apps/worker/src/middleware/csrf.ts`'s CSRF check only applies when a session cookie is present (browser/dashboard auth); Bearer `update_token` and header-presented JWT (`aired-Session`) requests are exempt by design since they aren't ambient credentials a browser can forge cross-site — see the doc comment on `CSRF_HEADER` in `packages/core/src/headers.ts`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
