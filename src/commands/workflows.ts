/**
 * Workflow (Flow) commands.
 *
 * Agents never edit flows directly: `workflows propose` creates a pending proposal that a
 * human accepts or rejects in the Flow Builder.
 */

import type { Command } from "commander";

import { output } from "../core/output";
import { bento } from "../core/sdk";
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
      "JSON file with the patch (add_nodes, update_nodes, ...)"
    )
    .requiredOption("--summary <text>", "One-line description of the change for the reviewer")
    .option(
      "--base-revision <revision>",
      "diagram_revision from 'workflows get' (detects staleness)"
    )
    .action(async (id: string, options: ProposeOptions) => {
      try {
        const workflowId = requireId(id);
        const summary = options.summary.trim();
        if (!summary) throw validationError("--summary cannot be empty.");
        const patch = parsePatch(await readSafeJsonFile(options.patchFile, "Patch file"));
        const baseRevision = options.baseRevision?.trim();

        output.startSpinner("Creating proposal...");
        const proposal = await bento.proposeWorkflowChange(workflowId, {
          summary,
          patch,
          ...(baseRevision ? { base_revision: baseRevision } : {}),
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
            output.log(`${proposal.id}: ${proposal.attributes.review_url}`);
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
  if (Object.keys(value).length === 0) {
    throw validationError("Patch file is empty.");
  }
  return value as WorkflowPatch;
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
  const nodes = a.nodes ?? [];
  if (nodes.length === 0) return;
  output.newline();
  output.table(
    nodes.map((node) => ({
      id: node.id,
      type: node.type ?? "",
      label: describeNode(node),
    })),
    {
      columns: [
        { key: "id", header: "NODE ID" },
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
