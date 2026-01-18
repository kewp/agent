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

import type { OllamaMessage, ToolDef, ToolCall, StreamChunk } from "./types.ts";

export type OllamaConfig = {
  baseUrl: string;
  model: string;
};

const DEFAULT_CONFIG: OllamaConfig = {
  baseUrl: "http://localhost:11434",
  model: "llama3.1:8b",
};

export type StreamResult = {
  content: string;
  toolCalls: ToolCall[];
};

// Stream chat completion from Ollama
// This is an async generator - it yields chunks as they arrive from the server
export async function* streamChat(
  messages: OllamaMessage[],
  tools: ToolDef[],
  config: Partial<OllamaConfig> = {},
): AsyncGenerator<StreamChunk> {
  const { baseUrl, model } = { ...DEFAULT_CONFIG, ...config };

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      tools,
      stream: true, // This enables streaming!
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  if (!res.body) {
    throw new Error("No response body from Ollama");
  }

  // Read the response body as a stream
  // res.body is a ReadableStream - we get a reader to consume it chunk by chunk
  const reader = res.body.getReader();
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
  }

  return { content, toolCalls };
}
