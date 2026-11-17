import type { Command } from "commander";

import { output } from "../core/output";
import { bento } from "../core/sdk";
import { emitJson, exitWithError, parsePositiveInt } from "../utils/command";

export function registerAuthorsCommands(program: Command): void {
  const authors = program.command("authors").description("List email authors (senders)");

  authors
    .command("list")
    .description("List authors; use the ID with --author-id on broadcasts")
    .option("--page <n>", "Page number")
    .action(async (options: { page?: string }) => {
      try {
        const page = parsePositiveInt(options.page, "--page");
        output.startSpinner("Fetching authors...");
        const list = await bento.getAuthors(page);
        output.stopSpinner();

        if (output.isJson()) {
          emitJson(list, { count: list.length });
          return;
        }

        output.table(
          list.map((author) => ({
            id: author.id,
            name: author.attributes.name ?? "",
            email: author.attributes.email ?? "",
          })),
          {
            columns: [
              { key: "id", header: "ID" },
              { key: "name", header: "NAME" },
              { key: "email", header: "EMAIL" },
            ],
            emptyMessage: "No authors found.",
          }
        );
      } catch (error) {
        exitWithError(error);
      }
    });
}
