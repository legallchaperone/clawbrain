# Contributing to clawbrain

Thank you for your interest in contributing to **clawbrain** — credit-assignment, self-evolving memory for OpenClaw agents.

## Getting Started

```bash
git clone https://github.com/legallchaperone/clawbrain.git
cd clawbrain
npm install
npm run build
npm test
```

## Development Workflow

- Run `npm test` before opening a pull request
- Run `npm run lint` to check for style issues
- TypeScript strict mode is enabled; all code must typecheck cleanly (`npm run build`)

## Project Structure

- `src/` — TypeScript source code
- `tests/` — Vitest test suite
- `docs/` — Architecture and configuration documentation
- `scripts/` — CLI utility scripts (`dashboard.sh`, `migrate.sh`, `export.sh`)
- `skills/` — Agent skill instructions for OpenClaw

## Opening Issues

- **Bug reports**: include your OpenClaw version, Node.js version, and steps to reproduce
- **Feature requests**: describe the use case and expected behavior

## Pull Requests

1. Fork the repository and create a branch from `main`
2. Make your changes with tests where applicable
3. Ensure `npm test` and `npm run lint` both pass
4. Open a pull request against `main`

## Code Style

- TypeScript with strict mode enabled
- ESLint enforces style rules (`npm run lint`)
- Prefer explicit types over `any`

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
