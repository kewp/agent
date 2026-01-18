// ollama.ts - Ollama client with streaming support
//
// ## What is streaming?
//
// Normally when you call an API, you send a request and wait for the complete
// response. With LLMs, generating a full response can take several seconds.
//
// Streaming lets you receive the response piece-by-piece as it's generated:
//
//   Non-streaming:  [wait 5 seconds...] "The answer is 42"
//   Streaming:      "The" ... "answer" ... "is" ... "42"  (each word arrives as generated)
//
// This gives a better UX because users see output immediately instead of staring
// at a blank screen. It's like the difference between watching a video stream
// vs waiting for the whole file to download.
//
// ## How it works
//
// 1. We send a request with `stream: true`
// 2. The server keeps the HTTP connection open
// 3. The server sends newline-delimited JSON chunks as tokens are generated
// 4. Each chunk has `{ message: { content: "word" }, done: false }`
// 5. The final chunk has `{ done: true }`
//
// We use an async generator (function*) to yield each chunk as it arrives,
// letting the caller process them one at a time.

import type { OllamaMessage, ToolDef, ToolCall, StreamChunk, TokenUsage } from "./types.ts";

export type OllamaConfig = {
  baseUrl: string;
  model: string;
  maxRetries?: number;   // Retry failed requests (default: 2)
  retryDelay?: number;   // Delay between retries in ms (default: 1000)
};

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: "http://localhost:11434",
  model: "devstral-small-2:latest",  // Good balance of tool use + general conversation
  maxRetries: 2,
  retryDelay: 1000,
};

// Sleep helper for retry delays
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Check if an error is retryable (network issues, server overload)
function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) {
    // Network errors (fetch failed, connection refused)
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Server overload, timeout, or temporary issues
    return msg.includes("503") || msg.includes("429") || msg.includes("timeout") || msg.includes("econnrefused");
  }
  return false;
}

export type StreamResult = {
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
};

// Stream chat completion from Ollama
// This is an async generator - it yields chunks as they arrive from the server
export async function* streamChat(
  messages: OllamaMessage[],
  tools: ToolDef[],
  config: Partial<OllamaConfig> = {},
): AsyncGenerator<StreamChunk> {
  const { baseUrl, model, maxRetries, retryDelay } = { ...DEFAULT_CONFIG, ...config };
  const retries = maxRetries ?? 2;
  const delay = retryDelay ?? 1000;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          tools: tools.length > 0 ? tools : undefined,  // Only send tools if we have them
          stream: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        const error = new Error(`Ollama error ${res.status}: ${body}`);
        // Retry on 503 (service unavailable) or 429 (rate limit)
        if ((res.status === 503 || res.status === 429) && attempt < retries) {
          lastError = error;
          await sleep(delay * (attempt + 1)); // Exponential backoff
          continue;
        }
        throw error;
      }

      if (!res.body) {
        throw new Error("No response body from Ollama");
      }

      // Success - break out of retry loop and process response
      // (the rest of the function will yield chunks from res.body)
      var reader = res.body.getReader();
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (isRetryableError(err) && attempt < retries) {
        await sleep(delay * (attempt + 1));
        continue;
      }
      throw lastError;
    }
  }

  if (!reader!) {
    throw lastError ?? new Error("Failed to connect to Ollama");
  }

  // Read the response body as a stream
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    // Read the next chunk of bytes from the stream
    const { done, value } = await reader.read();
    if (done) break;

    // Decode bytes to text and add to buffer
    // We buffer because chunks might split in the middle of a JSON line
    buffer += decoder.decode(value, { stream: true });

    // Split on newlines - each line is a complete JSON object
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const chunk = JSON.parse(line) as StreamChunk;
        yield chunk; // Yield to caller - they can print it, accumulate it, etc.
      } catch {
        // Skip malformed JSON
      }
    }
  }

  // Process any remaining data in buffer
  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer) as StreamChunk;
      yield chunk;
    } catch {
      // Skip malformed JSON
    }
  }
}

// Higher-level helper: stream the response and collect the final result
// The onContent callback is called for each text chunk (for live printing)
export async function chat(
  messages: OllamaMessage[],
  tools: ToolDef[],
  config: Partial<OllamaConfig> = {},
  onContent?: (chunk: string) => void,
): Promise<StreamResult> {
  let content = "";
  let toolCalls: ToolCall[] = [];
  let usage: TokenUsage | undefined;

  for await (const chunk of streamChat(messages, tools, config)) {
    // Accumulate text content
    if (chunk.message.content) {
      content += chunk.message.content;
      onContent?.(chunk.message.content); // Let caller print it live
    }
    // Tool calls come in the final chunk
    if (chunk.message.tool_calls) {
      toolCalls = chunk.message.tool_calls;
    }
    // Token counts come in the final chunk (when done=true)
    if (chunk.done && chunk.prompt_eval_count !== undefined) {
      usage = {
        promptTokens: chunk.prompt_eval_count,
        completionTokens: chunk.eval_count ?? 0,
        totalTokens: (chunk.prompt_eval_count) + (chunk.eval_count ?? 0),
      };
    }
  }

  return { content, toolCalls, usage };
}
