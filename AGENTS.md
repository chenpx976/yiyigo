# Repository Guidelines

## Project Overview
- YIYI GO / 弈意 is a browser Go game with 9/13/19 boards, local play, a worker-based heuristic bot, and SGF replay/import/export. Liberties, connections, and influence are integrated into the board.
- `DESIGN.md` governs visual requirements; `CONNECTIONS.md` describes current production geometry and state. Historical experiments in review documents do not override them.

## Architecture & Data Flow
- `index.html` loads `src/main.ts`, which owns game/review state, DOM bindings, persistence, SGF loading, and bot scheduling. `BoardView` receives state and invokes callbacks; game mutations stay in `main.ts`.
- `src/engine.ts` owns `Go`, legal moves, captures, history, undo, and SGF parsing. `src/position.ts` provides tactical descriptions and bot evaluation; `src/bot.worker.ts` reconstructs serialized positions and returns moves.
- Rendering flows through `board.ts` → `living-stones.ts` / `surface-model.ts` → texture-backed primitives → `implicit-stones.ts` ray-marched surfaces and matching shadow depth. `connection-envelope.ts` shares connection geometry between CPU evaluation and GLSL.
- Keep rule candidates (`engine.ts`), display selection (`connection-presentation.ts`), animation state (`connection-state.ts`, `surface-transition.ts`), and geometry separate. Influence has its own calculation, transition, and surface modules.

## Key Directories
- `src/`: application, rules, analysis, rendering, and styles; `tests/`: flat production-module regression tests.
- `public/games/`: professional SGFs and their license; `public/qi-mai/`: authored fixtures and independent expectations in `manifest.json`. Preserve game attribution and licensing.
- `dev/`: local visual-review pages and atlas helpers, separate from the published game. `artifacts/`: captured QA screenshots; `scripts/`: Pages publishing.

## Development Commands
- Setup/run: `npm ci`; `npm run dev` (also `npm start`) serves `http://127.0.0.1:4173` with a strict port.
- Build: `npm run build` runs typecheck then Vite; `npm run preview` serves the existing `dist/` on port 4174.
- Checks: `npm run typecheck`; `npm test`; `npm run check` combines typecheck, all tests, and build. No lint or formatter command is configured.
- Focused test: `node --import tsx --test tests/engine.test.ts`. `npm run test:qi-mai` selects seven corpus/atlas/surface suites; it does not cover every connection, focus, or influence regression.
- Publishing: `npm run deploy:pages` runs checks and pushes `dist/` to `gh-pages`. It requires clean `main`, HEAD matching remote `main`, GitHub origin, Git identity, and credentials; use only for an authorized deployment. See `README.md` and `scripts/deploy-pages.mjs`.

## Code Conventions & Common Patterns
- Use strict TypeScript, named exports, type-only imports, kebab-case module names, PascalCase types/classes, and camelCase functions. Match surrounding formatting; no formatter configuration exists.
- Dependencies are passed through functions and constructor callbacks; state belongs to `Go`, the application controller, or `BoardView`. Keep pure rule/model computations usable without a browser.
- Board indices are row-major (`y * n + x`); `0` is empty, colors are `1 | 2`, and `null` means pass. `Go.play()` returns an error string or `null`; rejected moves must not mutate state.
- Async bot work uses request IDs and worker termination to discard obsolete results. Record loading uses generation checks; preserve stale-result guards when changing async paths. Surface recoverable failures through UI status.
- Potential links never merge real groups or share liberties; display suppression must preserve tactical strength. Influence is neither territory nor win probability and retains separate black/white channels.
- Preserve `reset` / `retarget` / `sample` transition semantics. Retarget from the currently displayed state; focus changes must not restart stone or influence lifecycles. Support rapid undo, reduced motion, hidden-tab pausing, and resource cleanup.
- Preserve settled stone shapes and tangent connection roots; deform connecting material. Avoid duplicate-edge swelling, false nodes, sideways detours, and fixed gaps. Production camera stays directly overhead; angled views are review tools.

## Important Files
- `index.html`, `src/main.ts`, `src/board.ts`: HTML/DOM contract, application controller, and rendering/accessible interaction boundary.
- `src/engine.ts`, `src/connection-presentation.ts`, `src/connection-envelope.ts`, `src/surface-model.ts`: rules, visibility policy, shared geometry, and render records.
- `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`: canonical commands, dependencies, compiler options, and deployment base.
- `README.md`: setup/publishing; `DESIGN.md` and `CONNECTIONS.md`: current design/architecture; opening section of `TESTING.md`: latest recorded acceptance and limitations. Older QA sections contain superseded claims.

## Runtime/Tooling Preferences
- Use Node.js **>=22.12.0** and **npm** with `package-lock.json`; no Bun requirement or npm-version pin. The project is ESM with Vite, TypeScript, and Three.js, without a UI framework.
- Follow `tsconfig.json` (strict, ES2022, bundler resolution). Explicit typecheck roots are `src`, `tests`, and `vite.config.ts`; standalone `dev/` code is not automatically included unless imported.
- Preserve Vite `base: "./"`, `import.meta.env.BASE_URL` for public assets, and `new URL("./bot.worker.ts", import.meta.url)` for workers so subpath hosting works. Runtime assets are local; avoid introducing CDN/API dependencies.
- `dist/` is generated output. Review pages run under the dev server; `.openai/hosting.json` is historical and unused by current Pages publishing.

## Testing & QA
- Tests use `node:test` and `node:assert/strict` through `tsx`, importing production TypeScript. No numeric coverage threshold is configured; exercise relevant behavior with focused tests before broader checks.
- Protect legal replay/capture/undo, independent liberties, display-versus-tactical state, fixed stone geometry, symmetric connections, rapid transition reversals, and cleanup. New fixture regressions need explicit expected outcomes, minimal SGFs, and relevant color/direction variants.
- Visual changes require browser inspection of the main game and relevant `dev/` pages: begin with `/dev/case-atlas.html`, then roots/side views (`/dev/connection-lab.html`), real games and rapid interactions (`/dev/transition-review.html`); use `/dev/influence-review.html` for influence.
- CPU geometry assertions and GPU pixel comparisons do not establish visual quality. Save actual screenshots in `artifacts/` and record observed results and remaining limits in `TESTING.md`; do not present historical passes as fresh verification.

## Commit Attribution
- AI-authored commits must include a `Co-Authored-By:` trailer with the agent's own name and attribution byline.
