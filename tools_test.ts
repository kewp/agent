// tools_test.ts - Tests for tools
//
// Run with: deno test -A tools_test.ts

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { executeTool, getToolSchemas } from "./tools.ts";

// ============================================================================
// calc tool
// ============================================================================

Deno.test("calc: basic addition", async () => {
  const result = await executeTool("calc", { expression: "2+2" });
  assertEquals(result, "4");
});

Deno.test("calc: complex expression", async () => {
  const result = await executeTool("calc", { expression: "(10 + 5) * 2" });
  assertEquals(result, "30");
});

Deno.test("calc: decimal numbers", async () => {
  const result = await executeTool("calc", { expression: "3.14 * 2" });
  assertEquals(result, "6.28");
});

Deno.test("calc: rejects invalid characters", async () => {
  const result = await executeTool("calc", { expression: "console.log('hi')" });
  assertStringIncludes(result, "unsupported characters");
});

// ============================================================================
// list_dir tool
// ============================================================================

Deno.test("list_dir: current directory", async () => {
  const result = await executeTool("list_dir", { path: "." });
  // Should list files in current directory
  assertStringIncludes(result, "main.ts");
  assertStringIncludes(result, "tools.ts");
});

Deno.test("list_dir: default path", async () => {
  const result = await executeTool("list_dir", {});
  // With no path, should default to "."
  assertStringIncludes(result, "main.ts");
});

Deno.test("list_dir: nonexistent directory", async () => {
  const result = await executeTool("list_dir", { path: "/nonexistent/path" });
  assertStringIncludes(result, "ERROR");
});

// ============================================================================
// read_file tool
// ============================================================================

Deno.test("read_file: reads existing file", async () => {
  const result = await executeTool("read_file", { path: "types.ts" });
  assertStringIncludes(result, "export type");
});

Deno.test("read_file: handles missing file", async () => {
  const result = await executeTool("read_file", { path: "nonexistent.txt" });
  assertStringIncludes(result, "ERROR");
  assertStringIncludes(result, "not found");
});

// ============================================================================
// search_files tool
// ============================================================================

// Helper to check if ripgrep is available
async function hasRipgrep(): Promise<boolean> {
  try {
    const cmd = new Deno.Command("rg", { args: ["--version"], stdout: "null", stderr: "null" });
    const { success } = await cmd.output();
    return success;
  } catch {
    return false;
  }
}

Deno.test("search_files: finds matches", async () => {
  if (!(await hasRipgrep())) {
    console.log("  (skipped - ripgrep not installed)");
    return;
  }
  const result = await executeTool("search_files", { query: "export type" });
  assertStringIncludes(result, "types.ts");
});

Deno.test("search_files: empty query", async () => {
  const result = await executeTool("search_files", { query: "" });
  assertStringIncludes(result, "ERROR");
  assertStringIncludes(result, "empty");
});

Deno.test("search_files: no matches", async () => {
  if (!(await hasRipgrep())) {
    console.log("  (skipped - ripgrep not installed)");
    return;
  }
  // Search in a temp directory with no files
  const tmpDir = await Deno.makeTempDir();
  try {
    const result = await executeTool("search_files", { query: "anything", path: tmpDir });
    assertEquals(result, "(no matches)");
  } finally {
    await Deno.remove(tmpDir);
  }
});

// ============================================================================
// unknown tool
// ============================================================================

Deno.test("unknown tool returns error", async () => {
  const result = await executeTool("nonexistent_tool", {});
  assertStringIncludes(result, "unknown tool");
});

// ============================================================================
// getToolSchemas
// ============================================================================

Deno.test("getToolSchemas returns valid schemas", () => {
  const schemas = getToolSchemas();

  // Should have our tools
  const names = schemas.map((s) => s.function.name);
  assertEquals(names.includes("calc"), true);
  assertEquals(names.includes("read_file"), true);
  assertEquals(names.includes("list_dir"), true);
  assertEquals(names.includes("search_files"), true);

  // Each schema should have required fields
  for (const schema of schemas) {
    assertEquals(schema.type, "function");
    assertEquals(typeof schema.function.name, "string");
    assertEquals(typeof schema.function.description, "string");
    assertEquals(schema.function.parameters.type, "object");
  }
});
