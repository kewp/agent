# How This Agent Works

This document explains the concepts behind this AI agent and how the code is organized.

## What is an AI Agent?

An AI agent is a program that uses a language model (LLM) to accomplish tasks by:
1. Understanding what you want
2. Deciding what actions to take
3. Taking those actions (using "tools")
4. Repeating until the task is done

The key difference from a regular chatbot is that an agent can **do things**, not just talk.

```
Regular chatbot:
  You: "What files are in this directory?"
  Bot: "I don't know, I can't see your filesystem."

Agent:
  You: "What files are in this directory?"
  Agent: [calls list_dir tool] → "You have main.ts, agent.ts, and tools.ts"
```

## The Agent Loop

The core of any agent is the **agent loop**. Here's how it works:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. Send conversation to LLM                            │
│              ↓                                          │
│  2. LLM responds with either:                           │
│     ├─→ Text only → Done! Show response to user         │
│     └─→ Tool calls → Execute them, add results, goto 1  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

In code (`agent.ts`), this is a simple loop:

```ts
for (let step = 1; step <= maxSteps; step++) {
  const result = await chat(messages, tools);

  if (result.toolCalls.length === 0) {
    // No tool calls = LLM is done, show the response
    console.log(result.content);
    return;
  }

  // Execute each tool and add results to conversation
  for (const call of result.toolCalls) {
    const output = await executeTool(call.name, call.args);
    messages.push({ role: "tool", content: output });
  }
  // Loop continues...
}
```

The `maxSteps` limit prevents infinite loops if the model keeps requesting tools forever.

## Tools (Function Calling)

Tools give the LLM abilities beyond just generating text. Each tool has:
- **Name**: What to call it (e.g., `read_file`)
- **Description**: What it does (helps the LLM decide when to use it)
- **Parameters**: What inputs it needs (as JSON Schema)
- **Implementation**: The actual code that runs

Here's how a tool is defined (`tools.ts`):

```ts
{
  name: "read_file",
  description: "Read a text file by path",
  parameters: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string", description: "Path to the file" }
    }
  },
  execute: async (args) => {
    return await Deno.readTextFile(args.path);
  }
}
```

When you send a request to the LLM, you also send the list of available tools. The LLM can then "call" a tool by returning a structured response like:

```json
{
  "tool_calls": [{
    "function": {
      "name": "read_file",
      "arguments": { "path": "README.md" }
    }
  }]
}
```

The agent executes the tool and sends the result back to the LLM, which can then use that information to answer your question.

## Streaming

Normally, API calls work like this:
```
Request ──────────────────────────────→ [wait 5 seconds] ──→ Complete Response
```

With streaming, you get the response piece by piece as it's generated:
```
Request ──→ "The" ──→ "answer" ──→ "is" ──→ "42" ──→ Done
```

This is better UX because users see output immediately instead of staring at a blank screen.

### How streaming works technically

1. We send a request with `stream: true`
2. The server keeps the HTTP connection open
3. The server sends newline-delimited JSON as tokens are generated:
   ```
   {"message":{"content":"The"},"done":false}
   {"message":{"content":" answer"},"done":false}
   {"message":{"content":" is"},"done":false}
   {"message":{"content":" 42"},"done":true}
   ```
4. We read and process each chunk as it arrives

In code (`ollama.ts`), we use an async generator:

```ts
async function* streamChat(messages, tools) {
  const response = await fetch(url, { body: { stream: true, ... } });
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = JSON.parse(decode(value));
    yield chunk;  // Caller receives each chunk as it arrives
  }
}

// Usage:
for await (const chunk of streamChat(messages, tools)) {
  process.stdout.write(chunk.message.content);  // Print immediately
}
```

## Code Organization

```
agent/
├── main.ts      # CLI entry point - handles user input, REPL loop
├── agent.ts     # Agent loop - orchestrates LLM calls and tool execution
├── ollama.ts    # Ollama client - handles API calls and streaming
├── tools.ts     # Tool definitions - schema + implementation together
└── types.ts     # TypeScript types - shared across all files
```

### Data flow

```
User Input
    ↓
main.ts (CLI)
    ↓
agent.ts (Agent Loop)
    ↓
ollama.ts (LLM API) ←──→ Ollama Server
    ↓
tools.ts (Tool Execution)
    ↓
Response to User
```

## The Conversation History

The LLM is stateless - it doesn't remember previous messages. We maintain context by sending the full conversation history with each request:

```ts
const messages = [
  { role: "system", content: "You are a helpful assistant..." },
  { role: "user", content: "What files are here?" },
  { role: "assistant", tool_calls: [{ function: { name: "list_dir", ... }}] },
  { role: "tool", content: "main.ts\nagent.ts\n..." },
  { role: "assistant", content: "You have main.ts, agent.ts, and..." },
  { role: "user", content: "Read main.ts" },  // New message
  // ... history continues
];
```

Each turn adds to this history, giving the LLM context about what's happened.

## Why Self-Describing Tools?

In many codebases, tool schemas and implementations are separate:

```ts
// Schemas in one place
const schemas = [{ name: "calc", parameters: {...} }];

// Implementations in another
function runTool(name) {
  switch(name) {
    case "calc": return eval(expr);
  }
}
```

This is error-prone - schemas and implementations can drift apart. Instead, we keep them together:

```ts
const tools = [{
  name: "calc",
  parameters: {...},           // Schema
  execute: (args) => {...}     // Implementation
}];
```

Now it's impossible for them to get out of sync.

## Common Issues

### Model outputs JSON in text instead of making tool calls
Smaller models sometimes output `{"name": "tool", "parameters": {...}}` as text instead of using the proper tool_calls field. We handle this with a fallback parser in `agent.ts`.

### Model hallucinates non-existent tools
The system prompt explicitly lists available tools to reduce this. Larger models like `devstral-small-2` are better at following instructions.

### Streaming chunks split mid-JSON
Network chunks don't align with JSON boundaries. We buffer incoming data and split on newlines to get complete JSON objects.

## Further Reading

- [Ollama API docs](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling) (similar concept)
- [ReAct paper](https://arxiv.org/abs/2210.03629) (reasoning + acting pattern)
