import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { Command } from "commander";

import { registerSubscribersCommands } from "../../../commands/subscribers";
import { output } from "../../../core/output";
import { bento } from "../../../core/sdk";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSubscribersCommands(program);
  return program;
}

describe("subscribers subscribe command", () => {
  afterEach(() => {
    output.reset();
  });

  it("re-subscribes a single email", async () => {
    const subscribeSpy = spyOn(bento, "subscribe").mockResolvedValue(null);

    const program = buildProgram();
    await program.parseAsync([
      "node",
      "test",
      "subscribers",
      "subscribe",
      "--email",
      "user@example.com",
      "--confirm",
    ]);

    expect(subscribeSpy).toHaveBeenCalledWith("user@example.com");

    subscribeSpy.mockRestore();
  });

  it("shows help with --help flag", async () => {
    const program = buildProgram();

    let helpOutput = "";
    program.configureOutput({
      writeOut: (str) => { helpOutput += str; },
      writeErr: (str) => { helpOutput += str; },
    });

    try {
      await program.parseAsync(["node", "test", "subscribers", "subscribe", "--help"]);
    } catch {
      // Commander throws on --help with exitOverride
    }

    expect(helpOutput).toContain("Re-subscribe");
    expect(helpOutput).toContain("--email");
    expect(helpOutput).toContain("--file");
  });
});
