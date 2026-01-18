# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Agent

```bash
# Interactive chatbot mode
deno run -A main.ts

# Single question mode
deno run -A main.ts "What files are here?"

# Verbose mode (shows tool calls)
deno run -A main.ts -v "What is 2+2?"
```

## Running Tests

```bash
deno test -A
```

## Prerequisites

- Deno runtime
- Ollama running locally on port 11434
- Model `llama3.1:8b` pulled in Ollama (configurable in `ollama.ts`)
- `rg` (ripgrep) for the search_files tool (optional)

## Architecture

A modular AI agent that connects to a local Ollama instance with streaming support.

**Files**:
- `main.ts` - CLI entry point (interactive REPL or single question)
- `agent.ts` - Agent loop logic
- `ollama.ts` - Ollama client with streaming (well-commented explanation of how streaming works)
- `tools.ts` - Self-describing tools (schema + implementation together)
- `types.ts` - Shared TypeScript types

**Available Tools**:
- `calc` - Evaluates simple math expressions
- `read_file` - Reads text files (truncates at 20KB)
- `list_dir` - Lists directory contents
- `search_files` - Search using ripgrep

**Interactive Commands**:
- `/help` - Show help
- `/clear` - Clear conversation
- `/verbose` - Toggle verbose mode
- `/quit` - Exit
