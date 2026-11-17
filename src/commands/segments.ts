import type { Command } from "commander";

import { output } from "../core/output";
import { bento } from "../core/sdk";
import type { Segment } from "../types/agentic";
import {
  emitJson,
  exitWithError,
  formatTimestamp,
  parsePositiveInt,
  validationError,
} from "../utils/command";

export function registerSegmentsCommands(program: Command): void {
  // Creating and updating segments through the API is coming soon (the API answers 501).
  const segments = program
    .command("segments")
    .description("View subscriber segments (create and edit them in the Bento app)");

  segments
    .command("list")
    .description("List segments")
    .option("--page <n>", "Page number")
    .action(async (options: { page?: string }) => {
      try {
        const page = parsePositiveInt(options.page, "--page");
        output.startSpinner("Fetching segments...");
        const list = await bento.getSegments(page);
        output.stopSpinner();

        if (output.isJson()) {
          emitJson(list, { count: list.length });
          return;
        }

        output.table(
          list.map((segment) => ({
            id: segment.id,
            name: segment.attributes.name,
            created: formatTimestamp(segment.attributes.created_at),
          })),
          {
            columns: [
              { key: "id", header: "ID" },
              { key: "name", header: "NAME" },
              { key: "created", header: "CREATED" },
            ],
            emptyMessage: "No segments found.",
          }
        );
      } catch (error) {
        exitWithError(error);
      }
    });

  segments
    .command("get")
    .description("Show a segment, including its query JSON")
    .argument("<id>", "Segment ID")
    .action(async (id: string) => {
      try {
        output.startSpinner("Fetching segment...");
        const segment = await bento.getSegment(requireId(id));
        output.stopSpinner();

        if (output.isJson()) {
          emitJson(segment);
          return;
        }
        printSegment(segment);
      } catch (error) {
        exitWithError(error);
      }
    });
}

function requireId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw validationError("Segment ID cannot be empty.");
  return trimmed;
}

function printSegment(segment: Segment): void {
  const a = segment.attributes;
  output.log(`ID:          ${segment.id}`);
  output.log(`Name:        ${a.name}`);
  output.log(`Description: ${a.description ?? "—"}`);
  output.log(`Created:     ${formatTimestamp(a.created_at)}`);
  const query = a.visitor_event_query as unknown;
  if (query) {
    output.log("Query:");
    output.log(typeof query === "string" ? query : JSON.stringify(query, null, 2));
  }
}
