/**
 * Broadcasts commands
 *
 * Commands:
 * - bento broadcasts list - List all broadcasts
 * - bento broadcasts get <id> - Show one broadcast
 * - bento broadcasts create --name <n> --subject <s> [options] - Create a new broadcast draft
 * - bento broadcasts update <id> [options] - Edit a draft or scheduled broadcast
 */

import chalk from "chalk";
import type { Command } from "commander";
import { output } from "../core/output";
import { safety } from "../core/safety";
import { CLIError, bento } from "../core/sdk";
import type { BroadcastCreate, BroadcastDetail, BroadcastUpdate } from "../types/agentic";
import type { Broadcast, BroadcastType } from "../types/sdk";
import {
  emitJson,
  exitWithError,
  formatTimestamp,
  parseCsvList,
  parseFutureTimestamp,
  parsePositiveInt,
  validationError,
} from "../utils/command";
import { readSafeTextFile } from "../utils/files";

interface ListOptions {
  page?: string;
  perPage?: string;
}

interface CreateOptions {
  name: string;
  subject: string;
  content?: string;
  type?: BroadcastType;
  fromName?: string;
  fromEmail?: string;
  includeTags?: string;
  excludeTags?: string;
  batchSize?: string;
  previewText?: string;
  authorId?: string;
  segmentId?: string;
  sendAt?: string;
}

interface UpdateOptions {
  name?: string;
  subject?: string;
  htmlFile?: string;
  type?: string;
  previewText?: string;
  authorId?: string;
  segmentId?: string;
  includeTags?: string;
  excludeTags?: string;
  sendAt?: string;
  batchSize?: string;
  approve?: boolean;
  unapprove?: boolean;
  confirm?: boolean;
}

const MAX_HTML_BYTES = 524_288;
const UPDATE_CONTENT_TYPES = ["plain", "raw"] as const;
const MIN_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 500_000;

export function registerBroadcastsCommands(program: Command): void {
  const broadcasts = program.command("broadcasts").description("Manage email broadcasts");

  broadcasts
    .command("list")
    .description("List broadcasts")
    .option("--page <n>", "Page number (paginate instead of fetching all)")
    .option("--per-page <n>", "Results per page (default: 25, implies pagination)")
    .action(async (options: ListOptions) => {
      try {
        const hasCustomPerPage = options.perPage !== undefined;
        const paginated = !hasCustomPerPage && options.page !== undefined;

        if (hasCustomPerPage) {
          const page = parsePositiveInteger(options.page ?? "1", "--page");
          const perPage = parsePositiveInteger(options.perPage ?? "25", "--per-page");
          const offset = (page - 1) * perPage;

          output.startSpinner("Fetching broadcasts...");
          const broadcastList = await bento.getBroadcasts();
          output.stopSpinner();

          if (broadcastList.length === 0) {
            if (output.isJson()) {
              output.json({
                success: true,
                error: null,
                data: [],
                meta: { count: 0, page, pageSize: perPage, total: 0, hasMore: false },
              });
            } else {
              output.info("No broadcasts found.");
            }
            return;
          }

          const rows = broadcastsToRows(broadcastList);
          const total = rows.length;
          const pageRows = rows.slice(offset, offset + perPage);
          const hasMore = offset + pageRows.length < total;

          if (pageRows.length === 0) {
            if (output.isJson()) {
              output.json({
                success: true,
                error: null,
                data: [],
                meta: { count: 0, page, pageSize: perPage, total, hasMore: false },
              });
            } else {
              output.info(`No broadcasts found for page ${page}.`);
            }
            return;
          }

          if (output.isJson()) {
            output.json({
              success: true,
              error: null,
              data: pageRows,
              meta: { count: pageRows.length, total, page, pageSize: perPage, hasMore },
            });
            return;
          }

          output.table(pageRows, { columns: broadcastColumns(), meta: { total } });
          if (!output.isQuiet()) {
            const totalText = ` of ${total}`;
            const moreText = hasMore ? " (more available)" : "";
            output.info(`Page ${page}, showing ${pageRows.length}${totalText}${moreText}`);
          }
          return;
        }

        if (paginated) {
          const page = parsePositiveInteger(options.page ?? "1", "--page");
          const perPage = parsePositiveInteger(options.perPage ?? "25", "--per-page");

          output.startSpinner("Fetching broadcasts...");
          const result = await bento.getBroadcastsPage(page, perPage);
          output.stopSpinner();

          if (result.broadcasts.length === 0) {
            if (output.isJson()) {
              output.json({
                success: true,
                error: null,
                data: [],
                meta: {
                  count: 0,
                  page,
                  pageSize: perPage,
                  total: result.total ?? 0,
                  hasMore: false,
                },
              });
            } else {
              output.info("No broadcasts found.");
            }
            return;
          }

          if (output.isJson()) {
            output.json({
              success: true,
              error: null,
              data: broadcastsToRows(result.broadcasts),
              meta: {
                count: result.broadcasts.length,
                total: result.total,
                page,
                pageSize: perPage,
                hasMore: result.hasMore,
              },
            });
          } else {
            output.table(broadcastsToRows(result.broadcasts), {
              columns: broadcastColumns(),
              meta: { total: result.total },
            });

            if (!output.isQuiet()) {
              const totalText = typeof result.total === "number" ? ` of ${result.total}` : "";
              const moreText = result.hasMore ? " (more available)" : "";
              output.info(
                `Page ${page}, showing ${result.broadcasts.length}${totalText}${moreText}`
              );
            }
          }
        } else {
          // Default: fetch all broadcasts (original behavior)
          output.startSpinner("Fetching broadcasts...");
          const broadcastList = await bento.getBroadcasts();
          output.stopSpinner();

          if (broadcastList.length === 0) {
            if (output.isJson()) {
              output.json({
                success: true,
                error: null,
                data: [],
                meta: { count: 0 },
              });
            } else {
              output.info("No broadcasts found.");
            }
            return;
          }

          output.table(broadcastsToRows(broadcastList), {
            columns: broadcastColumns(),
            meta: { total: broadcastList.length },
          });
        }
      } catch (error) {
        output.failSpinner();
        if (error instanceof CLIError) {
          output.error(error.message);
        } else if (error instanceof Error) {
          output.error(error.message);
        } else {
          output.error("An unexpected error occurred.");
        }
        process.exit(1);
      }
    });

  broadcasts
    .command("create")
    .description("Create a new broadcast draft")
    .requiredOption("-n, --name <name>", "Broadcast name (internal identifier)")
    .requiredOption("-s, --subject <subject>", "Email subject line")
    .option("-c, --content <content>", "Email content (HTML, plain text, or markdown)")
    .option(
      "-t, --type <type>",
      "Content type: plain, html, or markdown (html and markdown use the raw editor)",
      "html"
    )
    .option("--from-name <name>", "Sender name")
    .option("--from-email <email>", "Sender email address")
    .option("--include-tags <tags>", "Comma-separated tags to include")
    .option("--exclude-tags <tags>", "Comma-separated tags to exclude")
    .option("--batch-size <size>", "Emails to send per hour", "1000")
    .option("--preview-text <text>", "Inbox preview text")
    .option("--author-id <id>", "Sender author ID from 'bento authors list'")
    .option("--segment-id <id>", "Segment ID to target")
    .option("--send-at <iso>", "Schedule time (ISO 8601, must be in the future)")
    .action(async (options: CreateOptions) => {
      try {
        // Validate type
        const validTypes: BroadcastType[] = ["plain", "html", "markdown"];
        const contentType = (options.type || "html") as BroadcastType;
        if (!validTypes.includes(contentType)) {
          output.error(`Invalid type "${options.type}". Must be one of: ${validTypes.join(", ")}`);
          process.exit(1);
        }

        // Parse batch size
        const batchSize = Number.parseInt(options.batchSize || "1000", 10);
        if (Number.isNaN(batchSize) || batchSize < 1) {
          output.error("Batch size must be a positive number.");
          process.exit(1);
        }
        if (batchSize < MIN_BATCH_SIZE || batchSize > MAX_BATCH_SIZE) {
          throw validationError(
            `Batch size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE} emails per hour.`
          );
        }
        if (options.fromEmail && options.authorId !== undefined) {
          throw validationError("Use either --from-email or --author-id, not both.");
        }

        const input: BroadcastCreate = {
          name: options.name,
          subject: options.subject,
          content: options.content || "",
          type: contentType,
          batch_size_per_hour: batchSize,
        };

        if (options.fromName || options.fromEmail || options.authorId === undefined) {
          input.from = { name: options.fromName || "", email: options.fromEmail || "" };
        }
        if (options.includeTags) input.inclusive_tags = parseCsvList(options.includeTags);
        if (options.excludeTags) input.exclusive_tags = parseCsvList(options.excludeTags);
        if (options.previewText !== undefined) input.preview_text = options.previewText;
        const authorId = parsePositiveInt(options.authorId, "--author-id");
        if (authorId !== undefined) input.author_id = authorId;
        const segmentId = parsePositiveInt(options.segmentId, "--segment-id");
        if (segmentId !== undefined) input.segment_id = segmentId;
        if (options.sendAt) input.send_at = parseFutureTimestamp(options.sendAt, "--send-at");

        output.startSpinner("Creating broadcast...");

        const result = await bento.createBroadcast(input);
        output.stopSpinner("Broadcast created");

        if (result.failed > 0) {
          const failureSummary = result.failures
            .map((failure) => failure.error ?? "Unknown error")
            .join("; ");
          output.error(
            failureSummary
              ? `Broadcast creation failed: ${failureSummary}`
              : "Broadcast creation failed."
          );
          process.exit(1);
        }

        if (output.isJson()) {
          output.json({
            success: result.results > 0,
            error: null,
            data: result,
            meta: { count: result.results, failed: result.failed },
          });
        } else if (!output.isQuiet()) {
          const createdName = result.broadcasts[0]?.name ?? options.name;
          output.success(`Created broadcast "${createdName}"`);
          output.info("Edit and send this broadcast from the Bento web dashboard.");
        }
      } catch (error) {
        output.failSpinner();
        if (error instanceof CLIError) {
          output.error(error.message);
        } else if (error instanceof Error) {
          output.error(error.message);
        } else {
          output.error("An unexpected error occurred.");
        }
        process.exit(1);
      }
    });

  broadcasts
    .command("get")
    .description("Show a broadcast's content, audience, schedule, and status")
    .argument("<id>", "Broadcast ID")
    .action(async (id: string) => {
      try {
        output.startSpinner("Fetching broadcast...");
        const broadcast = await bento.getBroadcast(requireId(id));
        output.stopSpinner();

        if (output.isJson()) {
          emitJson(broadcast);
          return;
        }
        printBroadcast(broadcast);
      } catch (error) {
        exitWithError(error);
      }
    });

  broadcasts
    .command("update")
    .description(
      "Update a draft or scheduled broadcast. Paused, sending, sent, and canceled broadcasts can't be edited."
    )
    .argument("<id>", "Broadcast ID")
    .option("--name <name>", "Broadcast name")
    .option("--subject <subject>", "Email subject line")
    .option("--html-file <path>", "Replace the email body with this HTML file")
    .option(
      "--type <type>",
      `Editor: ${UPDATE_CONTENT_TYPES.join(", ")} (required to replace a visual-editor body)`
    )
    .option("--preview-text <text>", "Inbox preview text")
    .option("--author-id <id>", "Sender author ID from 'bento authors list'")
    .option("--segment-id <id>", "Segment ID to target ('none' clears it)")
    .option("--include-tags <tags>", "Comma-separated tags to include ('' clears)")
    .option("--exclude-tags <tags>", "Comma-separated tags to exclude ('' clears)")
    .option("--send-at <iso>", "Schedule time (ISO 8601, must be in the future)")
    .option("--batch-size <size>", "Emails to send per hour")
    .option(
      "--approve",
      "Approve for sending at its future send time, or --send-at (asks for confirmation)"
    )
    .option("--unapprove", "Revoke approval")
    .option("--confirm", "Skip the approval confirmation prompt")
    .action(async (id: string, options: UpdateOptions) => {
      try {
        const broadcastId = requireId(id);
        const changes = await buildBroadcastUpdate(options);

        if (changes.approved === true) {
          const sendAt = await resolveApprovalSendTime(broadcastId, changes.send_at);
          const confirmed = await safety.confirmAction(
            `Approve broadcast ${broadcastId} to send at ${formatTimestamp(sendAt)} (${sendAt})?`,
            { confirm: Boolean(options.confirm) }
          );
          if (!confirmed) {
            output.warn("Approval cancelled; broadcast unchanged.");
            process.exitCode = 1;
            return;
          }
        }

        output.startSpinner("Updating broadcast...");
        const broadcast = await bento
          .updateBroadcast(broadcastId, changes)
          .catch((error: unknown) => {
            throw explainUpdateError(error);
          });
        output.stopSpinner("Broadcast updated");

        if (output.isJson()) {
          emitJson(broadcast, { count: 1, updatedFields: Object.keys(changes) });
          return;
        }
        if (!output.isQuiet()) {
          output.success(`Updated broadcast ${broadcastId}: ${Object.keys(changes).join(", ")}`);
          printBroadcast(broadcast);
        }
      } catch (error) {
        exitWithError(error);
      }
    });
}

async function buildBroadcastUpdate(options: UpdateOptions): Promise<BroadcastUpdate> {
  if (options.approve && options.unapprove) {
    throw validationError("Use only one of --approve or --unapprove.");
  }
  if (
    options.type !== undefined &&
    !UPDATE_CONTENT_TYPES.includes(options.type as (typeof UPDATE_CONTENT_TYPES)[number])
  ) {
    throw validationError(`--type must be one of: ${UPDATE_CONTENT_TYPES.join(", ")}`);
  }

  const changes: BroadcastUpdate = {};
  if (options.name !== undefined) changes.name = options.name;
  if (options.subject !== undefined) changes.subject = options.subject;
  if (options.htmlFile) {
    changes.content = await readSafeTextFile(options.htmlFile, "HTML file", MAX_HTML_BYTES);
  }
  if (options.type) changes.type = options.type as BroadcastUpdate["type"];
  if (options.previewText !== undefined) changes.preview_text = options.previewText;
  const authorId = parsePositiveInt(options.authorId, "--author-id");
  if (authorId !== undefined) changes.author_id = authorId;
  if (options.segmentId !== undefined) {
    changes.segment_id =
      options.segmentId.trim().toLowerCase() === "none"
        ? null
        : (parsePositiveInt(options.segmentId, "--segment-id") as number);
  }
  if (options.includeTags !== undefined) changes.inclusive_tags = parseCsvList(options.includeTags);
  if (options.excludeTags !== undefined) changes.exclusive_tags = parseCsvList(options.excludeTags);
  if (options.sendAt !== undefined) {
    changes.send_at = parseFutureTimestamp(options.sendAt, "--send-at");
  }
  const batchSize = parseBatchSize(options.batchSize);
  if (batchSize !== undefined) changes.batch_size_per_hour = batchSize;
  if (options.approve) changes.approved = true;
  if (options.unapprove) changes.approved = false;

  if (Object.keys(changes).length === 0) {
    throw validationError("Nothing to update. Pass at least one field flag (see --help).");
  }
  return changes;
}

/**
 * Bento only approves a broadcast whose send time is in the future, so find the time it will go out
 * at (the new --send-at, else the stored one) and refuse early when there isn't one.
 */
async function resolveApprovalSendTime(broadcastId: string, newSendAt?: string): Promise<string> {
  if (newSendAt) return newSendAt;
  const current = await bento.getBroadcast(broadcastId);
  const stored = current.attributes.send_at;
  if (!stored || new Date(stored).getTime() <= Date.now()) {
    throw validationError(
      `Broadcast ${broadcastId} has ${stored ? `a send time in the past (${stored})` : "no send time"}. Approve it with a future time: --approve --send-at <ISO 8601 time>.`
    );
  }
  return stored;
}

/** Add the CLI-side next step to the API's refusals. */
function explainUpdateError(error: unknown): unknown {
  if (!(error instanceof CLIError)) return error;
  if (error.statusCode === 409 && /can no longer be edited/i.test(error.message)) {
    return new CLIError(
      `${error.message}. Only draft and scheduled broadcasts can be changed through the API; manage paused or sending broadcasts in the Bento app.`,
      error.code,
      409,
      error.body
    );
  }
  if (
    error.statusCode === 422 &&
    /send time has passed|send_at must be in the future/i.test(error.message)
  ) {
    const message = error.message
      .replace("Pass a future send_at", "Pass a future --send-at")
      .replace("send_at must be in the future", "--send-at must be in the future");
    return new CLIError(message, error.code, 422, error.body);
  }
  return error;
}

function parseBatchSize(value: string | undefined): number | undefined {
  const size = parsePositiveInt(value, "--batch-size");
  if (size !== undefined && (size < MIN_BATCH_SIZE || size > MAX_BATCH_SIZE)) {
    throw validationError(`--batch-size must be between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}.`);
  }
  return size;
}

function requireId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw validationError("Broadcast ID cannot be empty.");
  return trimmed;
}

function printBroadcast(broadcast: BroadcastDetail): void {
  const a = broadcast.attributes;
  const audience = a.audience;
  const author = a.author
    ? `${a.author.name ?? ""} <${a.author.email ?? ""}> (id ${a.author.id})`
    : "—";
  const rows: Array<[string, string]> = [
    ["ID", broadcast.id],
    ["Name", a.name],
    ["Status", a.status],
    ["Subject", a.subject ?? "—"],
    ["Preview text", a.preview_text ?? "—"],
    ["Author", author],
    ["Segments", audience?.segment_ids.length ? audience.segment_ids.join(", ") : "—"],
    ["Include tags", audience?.inclusive_tags.length ? audience.inclusive_tags.join(", ") : "—"],
    ["Exclude tags", audience?.exclusive_tags.length ? audience.exclusive_tags.join(", ") : "—"],
    ["Send at", formatTimestamp(a.send_at)],
    ["Approved at", formatTimestamp(a.approved_at)],
    ["Batch size/hour", a.batch_size_per_hour?.toLocaleString() ?? "—"],
    ["Template ID", a.template_id?.toString() ?? "—"],
    ["Share URL", a.share_url ?? "—"],
  ];
  for (const [label, value] of rows) {
    output.log(`${chalk.bold(`${label}:`.padEnd(17))}${value}`);
  }
}

interface BroadcastListAttributes {
  name: string;
  subject?: string;
  created_at: string;
  template?: { subject?: string };
  stats?: { recipients?: number; total_opens?: number; total_clicks?: number };
}

function broadcastsToRows(broadcasts: Broadcast[]) {
  return broadcasts.map((b) => {
    const attrs = b.attributes as unknown as BroadcastListAttributes;

    return {
      name: attrs.name,
      subject: attrs.template?.subject ?? attrs.subject ?? "-",
      recipients: attrs.stats?.recipients?.toLocaleString() ?? "-",
      opens: attrs.stats?.total_opens?.toLocaleString() ?? "-",
      clicks: attrs.stats?.total_clicks?.toLocaleString() ?? "-",
      created: formatDate(attrs.created_at),
    };
  });
}

function broadcastColumns() {
  return [
    { key: "name" as const, header: "NAME" },
    { key: "subject" as const, header: "SUBJECT" },
    { key: "recipients" as const, header: "SENT" },
    { key: "opens" as const, header: "OPENS" },
    { key: "clicks" as const, header: "CLICKS" },
    { key: "created" as const, header: "CREATED" },
  ];
}

function parsePositiveInteger(value: string, flag: string): number {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    output.error(`${flag} must be a positive integer.`);
    process.exit(2);
  }
  return numeric;
}

/**
 * Format ISO date string for display
 */
function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}
