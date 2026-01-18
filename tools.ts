// tools.ts - Tool registry with self-describing tools

import type { Tool, ToolDef } from "./types.ts";

// Self-describing tool definitions
// Each tool has its schema (name, description, parameters) and implementation (execute)
// together in one place, so they can't drift apart.
const toolDefinitions: Tool[] = [
  {
    name: "calc",
    description: "Evaluate a simple math expression like '2+2' or '(10*5)/2'.",
    parameters: {
      type: "object",
      required: ["expression"],
      properties: {
        expression: { type: "string", description: "Math expression to evaluate" },
      },
    },
    execute: async (args) => {
      const expression = String(args.expression ?? "");
      if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        return "Error: expression contains unsupported characters.";
      }
      const value = Function(`"use strict"; return (${expression});`)();
      return String(value);
    },
  },

  {
    name: "read_file",
    description: "Read a text file. Path is relative to current directory.",
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Path to the file" },
      },
    },
    execute: async (args) => {
      const path = String(args.path ?? "");
      try {
        const text = await Deno.readTextFile(path);
        // Truncate at 4KB to keep context manageable for the model
        return text.length > 4_000 ? text.slice(0, 4_000) + "\n\n[TRUNCATED - file continues...]" : text;
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          return `ERROR: file not found: ${path}`;
        }
        return `ERROR: ${(err as Error).message}`;
      }
    },
  },

  {
    name: "list_dir",
    description: "List files and folders in a directory. Use '.' for current directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: current directory)" },
      },
    },
    execute: async (args) => {
      const dirPath = String(args.path || ".");
      try {
        const entries: string[] = [];
        for await (const e of Deno.readDir(dirPath)) {
          entries.push(`${e.isDirectory ? "[dir] " : "      "} ${e.name}`);
        }
        entries.sort();
        return entries.join("\n") || "(empty directory)";
      } catch (err) {
        return `ERROR: ${(err as Error).message}`;
      }
    },
  },

  {
    name: "search_files",
    description: "Search for text in files using ripgrep.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Text to search for" },
        path: { type: "string", description: "Directory to search in (default: current)" },
      },
    },
    execute: async (args) => {
      const query = String(args.query ?? "");
      const path = String(args.path || ".");

      if (!query.trim()) return "ERROR: query was empty";

      try {
        const command = new Deno.Command("rg", {
          args: ["-n", "--hidden", "--glob", "!.git/*", query, path],
          stdout: "piped",
          stderr: "piped",
        });
        const { stdout } = await command.output();
        const out = new TextDecoder().decode(stdout);
        const lines = out.split("\n").filter(Boolean).slice(0, 20);
        return lines.join("\n") || "(no matches)";
      } catch (err) {
        return `ERROR: ${(err as Error).message} (is ripgrep installed?)`;
      }
    },
  },
];

// Create a map for fast tool lookup
const toolMap = new Map(toolDefinitions.map((t) => [t.name, t]));

// Convert to Ollama's expected format for the API
export function getToolSchemas(): ToolDef[] {
  return toolDefinitions.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// Execute a tool by name
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const tool = toolMap.get(name);
  if (!tool) {
    return `Error: unknown tool "${name}"`;
  }

  try {
    return await tool.execute(args);
  } catch (err) {
    return `ERROR: ${(err as Error).message}`;
  }
}
