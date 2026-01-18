// agent.ts - The agent loop
//
// The agent loop is the core of an AI agent. It works like this:
//
// 1. Send the conversation to the LLM
// 2. If the LLM responds with text only → we're done, show the response
// 3. If the LLM requests tool calls → execute them, add results to conversation, goto 1
//
// This loop continues until the LLM decides it has enough information to answer,
// or we hit the maximum number of steps (to prevent infinite loops).

import type { OllamaMessage } from "./types.ts";
import type { OllamaConfig } from "./ollama.ts";
import { chat } from "./ollama.ts";
import { getToolSchemas, executeTool } from "./tools.ts";

const SYSTEM_PROMPT = `You are a helpful assistant with access to tools.
Use tools when you need information. When you have enough info, respond directly.
For file operations, use "." to refer to the current directory.`;

export type AgentOptions = {
  maxSteps?: number;
  verbose?: boolean;
  ollamaConfig?: Partial<OllamaConfig>;
};

// ANSI colors for terminal output
const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

// Single turn: send a message and get a response (may involve multiple LLM calls if tools are used)
export async function runAgentTurn(
  messages: OllamaMessage[],
  options: AgentOptions = {},
): Promise<string> {
  const { maxSteps = 10, verbose = false, ollamaConfig } = options;
  const tools = getToolSchemas();

  for (let step = 1; step <= maxSteps; step++) {
    if (verbose) {
      console.error(dim(`\n[step ${step}/${maxSteps}]`));
    }

    // Stream the response, printing content as it arrives
    const result = await chat(messages, tools, ollamaConfig, (chunk) => {
      Deno.stdout.writeSync(new TextEncoder().encode(chunk));
    });

    // Add assistant message to history
    const assistantMsg: OllamaMessage = {
      role: "assistant",
      content: result.content || undefined,
      tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
    };
    messages.push(assistantMsg);

    // No tool calls = we're done
    if (result.toolCalls.length === 0) {
      if (result.content) console.log(); // newline after streamed content
      return result.content;
    }

    // Execute each tool call
    if (verbose) {
      console.error(dim(`[${result.toolCalls.length} tool call(s)]`));
    }

    for (const call of result.toolCalls) {
      const name = call.function.name;
      const args = call.function.arguments ?? {};

      if (verbose) {
        console.error(dim(`  → ${name}(${JSON.stringify(args)})`));
      }

      const toolResult = await executeTool(name, args);

      if (verbose) {
        const preview = toolResult.slice(0, 80).replace(/\n/g, "\\n");
        console.error(dim(`  ← ${preview}${toolResult.length > 80 ? "..." : ""}`));
      }

      messages.push({
        role: "tool",
        tool_name: name,
        content: toolResult,
      });
    }
  }

  console.error(yellow(`\n[stopped after ${maxSteps} steps]`));
  return "";
}

// Create a new conversation with the system prompt
export function createConversation(): OllamaMessage[] {
  return [{ role: "system", content: SYSTEM_PROMPT }];
}

// Add a user message to the conversation
export function addUserMessage(messages: OllamaMessage[], content: string): void {
  messages.push({ role: "user", content });
}
