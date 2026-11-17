import type { Command } from "commander";

import { output } from "../core/output";
import { bento } from "../core/sdk";
import type { Segment, SegmentInput, SegmentQuery } from "../types/agentic";
import {
  emitJson,
  exitWithError,
  formatTimestamp,
  parsePositiveInt,
  validationError,
} from "../utils/command";
import { readSafeJsonFile } from "../utils/files";

interface SegmentWriteOptions {
  name?: string;
  description?: string;
  queryFile?: string;
}

export function registerSegmentsCommands(program: Command): void {
  const segments = program.command("segments").description("Manage subscriber segments");

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

  addWriteOptions(segments.command("create").description("Create a segment")).action(
    async (options: SegmentWriteOptions) => {
      try {
        if (!options.name?.trim()) throw validationError("--name is required.");
        const input = await buildSegmentInput(options);

        output.startSpinner("Creating segment...");
        const segment = await bento.createSegment(input);
        output.stopSpinner("Segment created");

        if (output.isJson()) {
          emitJson(segment);
          return;
        }
        output.success(`Created segment ${segment.id} "${segment.attributes.name}"`);
      } catch (error) {
        exitWithError(error);
      }
    }
  );

  addWriteOptions(segments.command("update").description("Update a segment"))
    .argument("<id>", "Segment ID")
    .action(async (id: string, options: SegmentWriteOptions) => {
      try {
        const segmentId = requireId(id);
        const input = await buildSegmentInput(options);
        if (Object.keys(input).length === 0) {
          throw validationError("Nothing to update. Pass --name, --description, or --query-file.");
        }

        output.startSpinner("Updating segment...");
        const segment = await bento.updateSegment(segmentId, input);
        output.stopSpinner("Segment updated");

        if (output.isJson()) {
          emitJson(segment);
          return;
        }
        output.success(`Updated segment ${segment.id}: ${Object.keys(input).join(", ")}`);
      } catch (error) {
        exitWithError(error);
      }
    });
}

function addWriteOptions(command: Command): Command {
  return command
    .option("--name <name>", "Segment name")
    .option("--description <text>", "Segment description")
    .option(
      "--query-file <path>",
      "JSON file with the QueryBuilder group (data.attributes.visitor_event_query from 'segments get --json')"
    );
}

async function buildSegmentInput(options: SegmentWriteOptions): Promise<SegmentInput> {
  const input: SegmentInput = {};
  if (options.name !== undefined) input.name = options.name.trim();
  if (options.description !== undefined) input.description = options.description;
  if (options.queryFile) {
    input.visitor_event_query = parseQuery(await readSafeJsonFile(options.queryFile, "Query file"));
  }
  return input;
}

function parseQuery(value: unknown): SegmentQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Query file must contain a JSON object.");
  }
  const query = value as SegmentQuery;
  if (!Array.isArray(query.rules)) {
    throw validationError(
      'Query file must be a QueryBuilder group, e.g. {"condition":"AND","rules":[...]}.'
    );
  }
  return query;
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
  if (a.visitor_event_query) {
    output.log("Query:");
    output.log(JSON.stringify(a.visitor_event_query, null, 2));
  }
}
