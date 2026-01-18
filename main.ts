#!/usr/bin/env -S deno run -A
// main.ts - Interactive chatbot
//
// Usage:
//   deno run -A main.ts              # Start interactive chat
//   deno run -A main.ts "question"   # Ask a single question
//   deno run -A main.ts -v           # Verbose mode (show tool calls)

import { createConversation, addUserMessage, runAgentTurn } from "./agent.ts";

const HELP = `
Commands:
  /help     Show this help
  /clear    Clear conversation history
  /verbose  Toggle verbose mode
  /quit     Exit (or Ctrl+C)
`.trim();

async function main() {
  const args = Deno.args;
  let verbose = args.includes("-v") || args.includes("--verbose");
  const nonFlagArgs = args.filter((a) => !a.startsWith("-"));

  // Single question mode
  if (nonFlagArgs.length > 0) {
    const question = nonFlagArgs.join(" ");
    const messages = createConversation();
    addUserMessage(messages, question);
    await runAgentTurn(messages, { verbose });
    return;
  }

  // Interactive mode
  console.log("Chat with the agent. Type /help for commands.\n");

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
      const cmd = input.toLowerCase();
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
      } else {
        console.log(`Unknown command: ${input}`);
      }
      continue;
    }

    // Send to agent
    addUserMessage(messages, input);
    console.log(); // blank line before response
    await runAgentTurn(messages, { verbose });
    console.log(); // blank line after response
  }
}

main();
