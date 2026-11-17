/**
 * Workflow (Flow) commands.
 *
 * Agents never edit flows directly: `workflows propose` creates a pending proposal that a
 * human accepts or rejects in the Flow Builder.
 */

import type { Command } from "commander";

import { output } from "../core/output";
import { CLIError, bento } from "../core/sdk";
import type { WorkflowDetail, WorkflowPatch, WorkflowProposal } from "../types/agentic";
import {
  emitJson,
  exitWithError,
  formatTimestamp,
  parsePositiveInt,
  truncate,
  validationError,
} from "../utils/command";
import { readSafeJsonFile } from "../utils/files";

interface ProposeOptions {
  patchFile: string;
  summary: string;
  baseRevision?: string;
}

const ACCEPT_HINT = "Nothing changes until someone accepts this proposal in the Flow Builder.";
const PATCH_OPERATIONS = [
  "add_nodes",
  "update_nodes",
  "remove_nodes",
  "move_nodes",
  "add_links",
  "remove_links",
  "update_links",
] as const;
const MAX_PATCH_BYTES = 64 * 1024;
const MAX_PATCH_CHANGES = 200;
const MAX_SUMMARY_LENGTH = 500;
const REVISION_PATTERN = /^[0-9a-f]{16}$/;

export function registerWorkflowsCommands(program: Command): void {
  const workflows = program
    .command("workflows")
    .description("Inspect flows and propose changes for review in the Flow Builder");

  workflows
    .command("list")
    .description("List workflows")
    .option("--page <n>", "Page number")
    .action(async (options: { page?: string }) => {
      try {
        const page = parsePositiveInt(options.page, "--page");
        output.startSpinner("Fetching workflows...");
        const list = await bento.getWorkflows(page);
        output.stopSpinner();

        if (output.isJson()) {
          emitJson(list, { count: list.length });
          return;
        }

        output.table(
          list.map((workflow) => ({
            id: workflow.id,
            name: workflow.attributes.name,
            status: workflow.attributes.status,
            created: formatTimestamp(workflow.attributes.created_at),
          })),
          {
            columns: [
              { key: "id", header: "ID" },
              { key: "name", header: "NAME" },
              { key: "status", header: "STATUS" },
              { key: "created", header: "CREATED" },
            ],
            emptyMessage: "No workflows found.",
          }
        );
      } catch (error) {
        exitWithError(error);
      }
    });

  workflows
    .command("get")
    .description("Show a workflow, its diagram revision, and node IDs")
    .argument("<id>", "Workflow ID")
    .action(async (id: string) => {
      try {
        output.startSpinner("Fetching workflow...");
        const workflow = await bento.getWorkflow(requireId(id));
        output.stopSpinner();

        if (output.isJson()) {
          emitJson(workflow);
          return;
        }
        printWorkflow(workflow);
      } catch (error) {
        exitWithError(error);
      }
    });

  workflows
    .command("propose")
    .description("Propose a change to a workflow. A human must accept it in the Flow Builder.")
    .argument("<id>", "Workflow ID")
    .requiredOption(
      "--patch-file <path>",
      "JSON patch (add_nodes, update_nodes, remove_nodes, add_links, remove_links, update_links); max 64KB, 200 changes"
    )
    .requiredOption("--summary <text>", "Description for the reviewer (max 500 characters)")
    .option(
      "--base-revision <revision>",
      "diagram_revision from 'workflows get' (detects staleness)"
    )
    .action(async (id: string, options: ProposeOptions) => {
      try {
        const workflowId = requireId(id);
        const summary = options.summary.trim().replace(/\s+/g, " ");
        if (!summary) throw validationError("--summary cannot be empty.");
        if (summary.length > MAX_SUMMARY_LENGTH) {
          throw validationError(`--summary must be ${MAX_SUMMARY_LENGTH} characters or fewer.`);
        }
        const baseRevision = options.baseRevision?.trim();
        if (baseRevision && !REVISION_PATTERN.test(baseRevision)) {
          throw validationError(
            "--base-revision must be the 16-character diagram_revision from 'bento workflows get'."
          );
        }
        const patch = parsePatch(await readSafeJsonFile(options.patchFile, "Patch file"));
        if ("move_nodes" in patch || "moveNodes" in patch) {
          output.warn("move_nodes is accepted but the Flow Builder does not apply moves yet.");
        }

        output.startSpinner("Creating proposal...");
        const proposal = await bento
          .proposeWorkflowChange(workflowId, {
            summary,
            patch,
            ...(baseRevision ? { base_revision: baseRevision } : {}),
          })
          .catch((error: unknown) => {
            throw explainProposalError(error, workflowId, baseRevision);
          });
        output.stopSpinner("Proposal created");

        if (output.isJson()) {
          emitJson(proposal, { count: 1, hint: ACCEPT_HINT });
          return;
        }

        const { status, review_url: reviewUrl, expires_at: expiresAt } = proposal.attributes;
        output.success(`Proposal ${proposal.id} is ${status}.`);
        if (reviewUrl) output.log(`Review: ${reviewUrl}`);
        if (expiresAt) output.log(`Expires: ${formatTimestamp(expiresAt)}`);
        for (const warning of proposal.attributes.warnings ?? []) output.warn(warning);
        output.info(ACCEPT_HINT);
      } catch (error) {
        exitWithError(error);
      }
    });

  workflows
    .command("proposals")
    .description("List pending and stale proposals for a workflow")
    .argument("<id>", "Workflow ID")
    .action(async (id: string) => {
      try {
        output.startSpinner("Fetching proposals...");
        const proposals = await bento.getWorkflowProposals(requireId(id));
        output.stopSpinner();

        if (output.isJson()) {
          emitJson(proposals, { count: proposals.length });
          return;
        }
        output.table(proposals.map(proposalRow), {
          columns: [
            { key: "id", header: "ID" },
            { key: "status", header: "STATUS" },
            { key: "source", header: "SOURCE" },
            { key: "summary", header: "SUMMARY" },
            { key: "created", header: "CREATED" },
          ],
          emptyMessage: "No pending proposals.",
        });
        for (const proposal of proposals) {
          if (proposal.attributes.review_url) {
            const by = proposal.attributes.created_by?.label;
            output.log(
              `${proposal.id}${by ? ` (by ${by})` : ""}: ${proposal.attributes.review_url}`
            );
          }
        }
      } catch (error) {
        exitWithError(error);
      }
    });
}

function parsePatch(value: unknown): WorkflowPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("Patch file must contain a JSON object.");
  }
  const patch = value as WorkflowPatch;
  const known = new Set<string>(PATCH_OPERATIONS.flatMap((op) => [op, camelCase(op)]));
  const unknown = Object.keys(patch).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw validationError(
      `Unknown patch keys: ${unknown.join(", ")}. Use ${PATCH_OPERATIONS.join(", ")}.`
    );
  }
  const lists = Object.entries(patch);
  const notArrays = lists.filter(([, items]) => !Array.isArray(items)).map(([key]) => key);
  if (notArrays.length > 0) {
    throw validationError(`Patch keys must be arrays: ${notArrays.join(", ")}`);
  }
  const changes = lists.reduce((sum, [, items]) => sum + (items as unknown[]).length, 0);
  if (changes === 0) throw validationError("Patch has no changes.");
  if (changes > MAX_PATCH_CHANGES) {
    throw validationError(`Patch has more than ${MAX_PATCH_CHANGES} changes.`);
  }
  if (Buffer.byteLength(JSON.stringify(patch), "utf8") > MAX_PATCH_BYTES) {
    throw validationError("Patch is larger than 64KB.");
  }
  return patch;
}

function camelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** A stale base revision answers 409 with the flow's current `revision`. */
function explainProposalError(
  error: unknown,
  workflowId: string,
  baseRevision: string | undefined
): unknown {
  if (!(error instanceof CLIError) || error.statusCode !== 409) return error;
  const { revision } = (error.body ?? {}) as { revision?: unknown };
  const current = typeof revision === "string" ? revision : null;
  const since = baseRevision ? ` since revision ${baseRevision}` : "";
  const now = current ? ` (now ${current})` : "";
  return new CLIError(
    `The flow changed${since}${now}. Re-fetch it with 'bento workflows get ${workflowId}', rebuild the patch against the current node IDs, and propose again with --base-revision ${current ?? "<new revision>"}.`,
    error.code,
    409,
    error.body
  );
}

function requireId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw validationError("Workflow ID cannot be empty.");
  return trimmed;
}

function proposalRow(proposal: WorkflowProposal) {
  const a = proposal.attributes;
  return {
    id: proposal.id,
    status: a.status,
    source: a.source,
    summary: truncate(a.summary, 60),
    created: formatTimestamp(a.created_at),
  };
}

function printWorkflow(workflow: WorkflowDetail): void {
  const a = workflow.attributes;
  output.log(`ID:       ${workflow.id}`);
  output.log(`Name:     ${a.name}`);
  output.log(`Status:   ${a.status}`);
  output.log(`Revision: ${a.diagram_revision ?? "—"}`);
  const rows = [
    ...(a.triggers ?? []).map((node) => ({ node, kind: "trigger" })),
    ...(a.nodes ?? []).map((node) => ({ node, kind: "action" })),
  ];
  if (rows.length === 0) return;
  output.newline();
  output.table(
    rows.map(({ node, kind }) => ({
      id: node.id,
      kind,
      type: node.type ?? "",
      label: describeNode(node),
    })),
    {
      columns: [
        { key: "id", header: "NODE ID" },
        { key: "kind", header: "KIND" },
        { key: "type", header: "TYPE" },
        { key: "label", header: "LABEL" },
      ],
    }
  );
}

function describeNode(node: Record<string, unknown>): string {
  for (const key of ["name", "label", "title", "subject"]) {
    const value = node[key];
    if (typeof value === "string" && value) return truncate(value, 60);
  }
  return "";
}
