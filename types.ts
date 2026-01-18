// types.ts - Shared type definitions

export type Role = "system" | "user" | "assistant" | "tool";

// JSON Schema for describing tool parameters
export type JSONSchema = {
  type: "object";
  required?: string[];
  properties: Record<string, { type: string; description?: string }>;
};

// A self-describing tool: schema + implementation in one object
export type Tool = {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (args: Record<string, unknown>) => Promise<string>;
};

// Ollama API: how tools are sent to the model
export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
};

// Ollama API: a tool call request from the model
export type ToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

// Ollama API: a message in the conversation
export type OllamaMessage = {
  role: Role;
  content?: string;
  tool_calls?: ToolCall[];
  tool_name?: string; // set when role === "tool"
};

// Ollama API: a streaming chunk
export type StreamChunk = {
  message: {
    role: Role;
    content?: string;
    tool_calls?: ToolCall[];
  };
  done: boolean;
  done_reason?: string;
  // Token counts (only present in final chunk when done=true)
  prompt_eval_count?: number;  // Tokens in the prompt
  eval_count?: number;         // Tokens generated
};

// Token usage statistics
export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};
