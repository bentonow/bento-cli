import { spyOn } from "bun:test";
import { Command } from "commander";

import { output } from "../core/output";
import type { CLIResponse } from "../types/output";

export interface Harness {
  /** Runs the command; resolves to the exit code (0 when process.exit was not called). */
  run(args: string[]): Promise<number>;
  stdout(): string;
  stderr(): string;
  /** The last JSON envelope printed via output.json / output.jsonError. */
  json<T = unknown>(): CLIResponse<T>;
  restore(): void;
}

/**
 * Builds a program with one command group and captures console output and exits,
 * so tests assert on what a user (or agent) would actually see.
 */
export function createHarness(
  register: (program: Command) => void,
  mode: "normal" | "json" = "normal"
): Harness {
  output.reset();
  output.setInteractiveOverride(false);
  output.setMode(mode);

  const out: string[] = [];
  const err: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  const warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as never);

  return {
    async run(args) {
      const program = new Command();
      program.exitOverride();
      register(program);
      try {
        await program.parseAsync(["node", "bento", ...args]);
        const code = process.exitCode ?? 0;
        process.exitCode = 0;
        return Number(code);
      } catch (error) {
        if (error instanceof ExitSignal) return error.code;
        throw error;
      }
    },
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
    json<T>() {
      const source = [...out, ...err].reverse().find((line) => line.trim().startsWith("{"));
      if (!source) throw new Error(`no JSON printed. stdout: ${out.join("\n")}`);
      return JSON.parse(source) as CLIResponse<T>;
    },
    restore() {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      exitSpy.mockRestore();
      output.reset();
    },
  };
}

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit:${code}`);
  }
}
