import type { Command } from "commander";

import { registerActivityCommand } from "./activity";
import { registerImportCommand } from "./import";
import { registerSearchCommand } from "./search";
import { registerSubscribeCommand } from "./subscribe";
import { registerTagCommand } from "./tag";
import { registerUnsubscribeCommand } from "./unsubscribe";

export function registerSubscribersCommands(program: Command): void {
  const subscribers = program.command("subscribers").description("Manage subscribers");

  registerSearchCommand(subscribers);
  registerActivityCommand(subscribers);
  registerImportCommand(subscribers);
  registerTagCommand(subscribers);
  registerSubscribeCommand(subscribers);
  registerUnsubscribeCommand(subscribers);
}
