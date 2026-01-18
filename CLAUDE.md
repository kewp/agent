# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Agent

```bash
# Interactive chatbot mode
deno run -A main.ts

# Single question mode
deno run -A main.ts "What files are here?"

# Verbose mode (shows tool calls + token usage)
deno run -A main.ts -v "Read CLAUDE.md"

# Use a specific model
deno run -A main.ts --model llama3.1:8b "What is 2+2?"
```

## Running Tests

```bash
deno test -A
```

## Prerequisites

- Deno runtime
- Ollama running locally on port 11434
- Model `devstral-small-2` (default) or any other model pulled in Ollama
- `rg` (ripgrep) for the search_files tool (optional)

## Architecture

A modular AI agent that connects to a local Ollama instance with streaming support.

**Files**:
- `main.ts` - CLI entry point (interactive REPL or single question)
- `agent.ts` - Agent loop logic with token tracking
- `ollama.ts` - Ollama client with streaming and retry logic
- `tools.ts` - Self-describing tools (schema + implementation together)
- `types.ts` - Shared TypeScript types
- `HOW_IT_WORKS.md` - Detailed explanation of how agents work

**Available Tools**:
- `calc` - Evaluate math expressions
- `read_file` - Read text files (truncated at 4KB)
- `list_dir` - List directory contents
- `search_files` - Search using ripgrep

**Interactive Commands**:
- `/help` - Show help
- `/clear` - Clear conversation
- `/verbose` - Toggle verbose mode (shows tokens)
- `/model X` - Switch to model X
- `/quit` - Exit

## Stability Features

- Automatic retries on network errors (2 retries with backoff)
- 60 second timeout per agent turn
- Max 5 steps per turn (prevents infinite loops)
- Token tracking in verbose mode
