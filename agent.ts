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

import type { OllamaMessage, ToolCall } from "./types.ts";
import type { OllamaConfig } from "./ollama.ts";
import { chat } from "./ollama.ts";
import { getToolSchemas, executeTool } from "./tools.ts";

// Some smaller models output tool calls as JSON in their text instead of using
// the proper tool_calls field. This function tries to extract them.
function extractToolCallsFromText(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  // Look for JSON objects that look like tool calls
  const jsonPattern = /\{[\s]*"name"[\s]*:[\s]*"([^"]+)"[\s]*,[\s]*"parameters"[\s]*:[\s]*(\{[^}]+\})[\s]*\}/g;
  let match;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const args = JSON.parse(match[2]);
      calls.push({ function: { name: match[1], arguments: args } });
    } catch {
      // Invalid JSON, skip
    }
  }
  return calls;
}

const SYSTEM_PROMPT = `You are a coding assistant. Tools: calc, list_dir, read_file, search_files.

RULES:
- Maximum 2-3 tool calls total, then answer
- Never read the same file twice
- Be concise`;

export type AgentOptions = {
  maxSteps?: number;
  verbose?: boolean;
  timeout?: number; // Max time in ms for entire turn
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
  const { maxSteps = 5, verbose = false, timeout = 60000, ollamaConfig } = options;
  const startTime = Date.now();
  const tools = getToolSchemas();

  for (let step = 1; step <= maxSteps; step++) {
    // Check timeout
    if (Date.now() - startTime > timeout) {
      console.error(yellow(`\n[timeout after ${Math.round(timeout / 1000)}s]`));
      return "";
    }

    if (verbose) {
      console.error(dim(`\n[step ${step}/${maxSteps}]`));
    }

    // Collect the response (we'll decide whether to print it after we know if there are tool calls)
    let streamedContent = "";
    const result = await chat(messages, tools, ollamaConfig, (chunk) => {
      streamedContent += chunk;
    });

    // Check for tool calls - either proper ones or extracted from text
    let toolCalls = result.toolCalls;
    let cleanContent = result.content;

    // Fallback: some smaller models output tool calls as JSON in text
    if (toolCalls.length === 0 && result.content) {
      const extracted = extractToolCallsFromText(result.content);
      if (extracted.length > 0) {
        toolCalls = extracted;
        // Remove the JSON from the displayed content
        cleanContent = result.content
          .replace(/\{[\s]*"name"[\s]*:[\s]*"[^"]+?"[\s]*,[\s]*"parameters"[\s]*:[\s]*\{[^}]+\}[\s]*\}/g, "")
          .trim();
      }
    }

    // Add assistant message to history
    const assistantMsg: OllamaMessage = {
      role: "assistant",
      content: result.content || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    };
    messages.push(assistantMsg);

    // No tool calls = we're done, print the response
    if (toolCalls.length === 0) {
      if (result.content) {
        console.log(result.content);
      }
      return result.content;
    }

    // If there are tool calls, the text was just "thinking" - don't print it
    // (small models often output planning text alongside tool calls)

    // Execute each tool call
    if (verbose) {
      console.error(dim(`[${toolCalls.length} tool call(s)]`));
    }

    for (const call of toolCalls) {
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
