# Changelog

## [0.1.0] - 2026-08-17

### Phase 0 — Scaffolding & Environment
- Project skeleton: package.json, tsconfig.json, biome.json
- Config system: TOML-based, load/save/merge with defaults
- CLI entrypoint: `harness --version`, `harness init`, `harness run`
- Structured logger with console + file output
- Test suite: config round-trip, CLI smoke test

## [Unreleased]

### Added
- Phase 2: Provider Abstraction Layer
    - Added `OpenAIProvider` using standard Chat Completions API.
    - Added `OllamaProvider` extending `OpenAIProvider` for local LLMs.
    - Added `ProviderRegistry` to register and load providers from `HarnessConfig`.
    - Added provider contract tests to ensure consistent response formatting.
- Phase 1: Core Agent Loop
    - Defined provider-agnostic message and event types in `src/agent/types.ts`
    - Created base Provider interface in `src/providers/base.ts`
    - Implemented Anthropic API adapter in `src/providers/anthropic.ts`
    - Created the core agent loop using AsyncGenerator in `src/agent/loop.ts`
    - Updated CLI run command to initialize agent loop and mock tool- Phase 3: Tool Registry and Built-in Tools (File Ops, Glob, Grep, Shell, MCP Client) 
