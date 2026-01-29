import type { Command } from "commander";

import { registerSearchCommand } from "./search";
import { registerImportCommand } from "./import";
import { registerTagCommand } from "./tag";
import { registerSuppressCommand } from "./suppress";

export function registerSubscribersCommands(program: Command): void {
  const subscribers = program.command("subscribers").description("Manage subscribers");

  registerSearchCommand(subscribers);
  registerImportCommand(subscribers);
  registerTagCommand(subscribers);
  registerSuppressCommand(subscribers);
}
