# Architecture

## Project Structure
- `src/cli`: CLI entrypoint using Commander.js.
- `src/config`: Configuration management using TOML.
- `src/logger.ts`: Centralized structured logging.
- `tests`: Test suites mirroring `src`.

## Key Decisions
- **Runtime**: Bun for fast execution, native TypeScript support, and SQLite ecosystem.
- **Config**: TOML format (via `smol-toml`) for human-readable configuration files.
- **CLI**: `commander` for robust command line argument parsing.
- **Testing**: `bun:test` to avoid external test runners.

## Known Deviations
None.
