#!/usr/bin/env -S deno run -A
// main.ts - Interactive chatbot
//
// Usage:
//   deno run -A main.ts                    # Start interactive chat
//   deno run -A main.ts "question"         # Ask a single question
//   deno run -A main.ts -v                 # Verbose mode (show tool calls + tokens)
//   deno run -A main.ts --model llama3.1:8b  # Use a different model

import { createConversation, addUserMessage, runAgentTurn } from "./agent.ts";

const HELP = `
Commands:
  /help     Show this help
  /clear    Clear conversation history
  /verbose  Toggle verbose mode
  /model X  Switch to model X
  /quit     Exit (or Ctrl+C)
`.trim();

// Parse --model or -m flag
function parseModel(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model" || args[i] === "-m") {
      return args[i + 1];
    }
    if (args[i].startsWith("--model=")) {
      return args[i].split("=")[1];
    }
  }
  return undefined;
}

async function main() {
  const args = Deno.args;
  let verbose = args.includes("-v") || args.includes("--verbose");
  let model = parseModel(args);

  // Filter out flags and their values
  const nonFlagArgs = args.filter((a, i) => {
    if (a.startsWith("-")) return false;
    // Also filter out model value after --model or -m
    const prev = args[i - 1];
    if (prev === "--model" || prev === "-m") return false;
    return true;
  });

  const ollamaConfig = model ? { model } : undefined;

  // Single question mode
  if (nonFlagArgs.length > 0) {
    const question = nonFlagArgs.join(" ");
    const messages = createConversation();
    addUserMessage(messages, question);
    await runAgentTurn(messages, { verbose, ollamaConfig });
    return;
  }

  // Interactive mode
  console.log("Chat with the agent. Type /help for commands.");
  if (model) console.log(`Using model: ${model}`);
  console.log();

  let messages = createConversation();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  while (true) {
    // Print prompt
    Deno.stdout.writeSync(encoder.encode("\x1b[36myou>\x1b[0m "));

    // Read line from stdin
    const buf = new Uint8Array(1024);
    const n = await Deno.stdin.read(buf);
    if (n === null) break; // EOF

    const input = decoder.decode(buf.subarray(0, n)).trim();
    if (!input) continue;

    // Handle commands
    if (input.startsWith("/")) {
      const parts = input.split(/\s+/);
      const cmd = parts[0].toLowerCase();

      if (cmd === "/quit" || cmd === "/exit" || cmd === "/q") {
        break;
      } else if (cmd === "/help" || cmd === "/h") {
        console.log(HELP);
      } else if (cmd === "/clear") {
        messages = createConversation();
        console.log("(conversation cleared)");
      } else if (cmd === "/verbose" || cmd === "/v") {
        verbose = !verbose;
        console.log(`(verbose mode: ${verbose ? "on" : "off"})`);
      } else if (cmd === "/model") {
        if (parts[1]) {
          model = parts[1];
          console.log(`(switched to model: ${model})`);
        } else {
          console.log(`(current model: ${model ?? "default"})`);
        }
      } else {
        console.log(`Unknown command: ${cmd}`);
      }
      continue;
    }

    // Send to agent
    addUserMessage(messages, input);
    console.log(); // blank line before response
    const currentConfig = model ? { model } : undefined;
    await runAgentTurn(messages, { verbose, ollamaConfig: currentConfig });
    console.log(); // blank line after response
  }
}

main();
