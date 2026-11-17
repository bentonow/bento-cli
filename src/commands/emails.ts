/**
 * Email render / test commands.
 *
 * Agent loop: `emails render` (validate Liquid) → `emails test` (send to yourself) → apply.
 */

import chalk from "chalk";
import type { Command } from "commander";

import { output } from "../core/output";
import { bento } from "../core/sdk";
import type { EmailRender, EmailSource, LiquidIssue, RenderedEmail } from "../types/agentic";
import {
  emitJson,
  exitWithError,
  parseEmailList,
  parsePositiveInt,
  validationError,
} from "../utils/command";
import { isValidEmail } from "../utils/csv";
import { readSafeTextFile, writeSafeTextFile } from "../utils/files";

interface SourceOptions {
  templateId?: string;
  broadcastId?: string;
  subject?: string;
  htmlFile?: string;
  previewText?: string;
  email?: string;
}

interface RenderOptions extends SourceOptions {
  html?: boolean;
  out?: string;
}

interface TestOptions extends SourceOptions {
  to: string;
  dryRun?: boolean;
}

const MAX_HTML_BYTES = 524_288;
const MAX_TEST_RECIPIENTS = 5;

export function registerEmailsCommands(program: Command): void {
  const emails = program
    .command("emails")
    .description("Render, validate, and test-send emails (Liquid aware)");

  addSourceOptions(
    emails
      .command("render")
      .description("Render an email and validate its Liquid. Exits 1 when invalid. Never sends.")
  )
    .option("--html", "Print the rendered HTML instead of the text body")
    .option("--out <file>", "Write the rendered HTML to a file")
    .action(async (options: RenderOptions) => {
      let valid: boolean;
      try {
        const source = await resolveEmailSource(options);
        const asEmail = resolveSubscriberEmail(options.email);

        output.startSpinner("Rendering email...");
        const render = await bento.renderEmail(source, asEmail);
        output.stopSpinner();

        valid = render.attributes.valid;
        const { rendered } = render.attributes;
        const outPath =
          options.out && rendered?.html
            ? await writeSafeTextFile(options.out, "Output file", rendered.html)
            : undefined;

        if (output.isJson()) {
          output.json({
            success: valid,
            error: valid ? null : "Email has Liquid errors.",
            data: render,
            meta: { count: 1, ...(outPath ? { out: outPath } : {}) },
          });
        } else {
          printRender(render, options.html ? "html" : "text");
          if (outPath) output.success(`Wrote rendered HTML to ${outPath}`);
          if (options.out && !outPath) output.warn(`Nothing rendered; ${options.out} not written.`);
        }
      } catch (error) {
        exitWithError(error);
      }
      if (!valid) process.exit(1);
    });

  addSourceOptions(
    emails
      .command("test")
      .description("Send a rendered test email to up to 5 team or verified-domain addresses")
  )
    .requiredOption("--to <emails>", `Comma-separated recipients (max ${MAX_TEST_RECIPIENTS})`)
    .option("--dry-run", "Render and validate only; do not send")
    .action(async (options: TestOptions) => {
      let valid = true;
      try {
        const source = await resolveEmailSource(options);
        const asEmail = resolveSubscriberEmail(options.email);
        const to = parseEmailList(options.to, "--to", MAX_TEST_RECIPIENTS);

        if (options.dryRun) {
          output.startSpinner("Rendering email (dry run)...");
          const render = await bento.renderEmail(source, asEmail);
          output.stopSpinner();
          valid = render.attributes.valid;

          if (output.isJson()) {
            output.json({
              success: valid,
              error: valid ? null : "Email has Liquid errors.",
              data: { dryRun: true, to, render },
              meta: { count: 0 },
            });
          } else {
            printRender(render, "text");
            output.info(`Dry run: would send to ${to.join(", ")}. Nothing was sent.`);
          }
        } else {
          await sendTest(source, to, asEmail);
        }
      } catch (error) {
        exitWithError(error);
      }
      if (!valid) process.exit(1);
    });
}

async function sendTest(source: EmailSource, to: string[], asEmail?: string): Promise<void> {
  output.startSpinner("Sending test email...");
  const result = await bento.sendTestEmail(source, to, asEmail);
  output.stopSpinner();

  const { deliveries, warnings } = result.attributes;
  if (output.isJson()) {
    emitJson(result, { count: deliveries.length });
    return;
  }

  output.success(`Test email ${result.attributes.status} for ${deliveries.length} recipient(s)`);
  output.table(
    deliveries.map((delivery) => ({
      to: delivery.to,
      status: delivery.status,
      job: delivery.job_id ?? "",
    })),
    {
      columns: [
        { key: "to", header: "TO" },
        { key: "status", header: "STATUS" },
        { key: "job", header: "JOB ID" },
      ],
    }
  );
  printIssues("Warnings", warnings, chalk.yellow("⚠"));
}

function addSourceOptions(command: Command): Command {
  return command
    .option("--template-id <id>", "Render an existing email template")
    .option("--broadcast-id <id>", "Render an existing broadcast")
    .option("--subject <subject>", "Raw subject (use with --html-file)")
    .option("--html-file <path>", "Raw HTML body file (use with --subject)")
    .option("--preview-text <text>", "Raw preview text (use with --subject and --html-file)")
    .option("--email <email>", "Render as this subscriber (default: the site's sample subscriber)");
}

export async function resolveEmailSource(options: SourceOptions): Promise<EmailSource> {
  const hasRaw =
    options.subject !== undefined ||
    options.htmlFile !== undefined ||
    options.previewText !== undefined;
  const chosen = [options.templateId !== undefined, options.broadcastId !== undefined, hasRaw];
  if (chosen.filter(Boolean).length !== 1) {
    throw validationError(
      "Provide exactly one source: --template-id, --broadcast-id, or --subject with --html-file."
    );
  }

  if (options.templateId !== undefined) {
    return {
      kind: "template",
      templateId: parsePositiveInt(options.templateId, "--template-id") as number,
    };
  }
  if (options.broadcastId !== undefined) {
    return {
      kind: "broadcast",
      broadcastId: parsePositiveInt(options.broadcastId, "--broadcast-id") as number,
    };
  }
  if (!options.subject || !options.htmlFile) {
    throw validationError("Raw emails need both --subject and --html-file.");
  }
  const html = await readSafeTextFile(options.htmlFile, "HTML file", MAX_HTML_BYTES);
  return {
    kind: "raw",
    subject: options.subject,
    html,
    ...(options.previewText !== undefined ? { previewText: options.previewText } : {}),
  };
}

function resolveSubscriberEmail(email: string | undefined): string | undefined {
  if (email === undefined) return undefined;
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) {
    throw validationError(`--email must be a valid email address: ${email}`);
  }
  return trimmed;
}

function printRender(render: EmailRender, body: "html" | "text"): void {
  const { valid, errors, warnings, rendered, rendered_as: renderedAs } = render.attributes;
  const status = valid ? chalk.green("✓ Valid") : chalk.red("✗ Invalid");
  output.log(`${status}${renderedAs ? chalk.dim(` (rendered as ${renderedAs})`) : ""}`);

  printIssues("Errors", errors, chalk.red("✗"));
  printIssues("Warnings", warnings, chalk.yellow("⚠"));

  if (!rendered) {
    output.newline();
    output.log(chalk.dim("Not rendered: fix the errors above first."));
    return;
  }
  printRendered(rendered, body);
}

function printIssues(title: string, issues: LiquidIssue[], marker: string): void {
  if (issues.length === 0) return;
  output.newline();
  output.log(chalk.bold(`${title}:`));
  for (const issue of issues) {
    const location = issue.line ? `${issue.field}:${issue.line}` : issue.field;
    output.log(`  ${marker} ${location} ${issue.message}`);
  }
}

function printRendered(rendered: RenderedEmail, body: "html" | "text"): void {
  output.newline();
  output.log(`${chalk.bold("Subject:")} ${rendered.subject ?? ""}`);
  output.log(`${chalk.bold("Preview:")} ${rendered.preview_text ?? ""}`);
  if (rendered.from) output.log(`${chalk.bold("From:")}    ${rendered.from}`);
  if (rendered.to) output.log(`${chalk.bold("To:")}      ${rendered.to}`);
  output.divider();
  output.log((body === "html" ? rendered.html : rendered.text) ?? "");
}
