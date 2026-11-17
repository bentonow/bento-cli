import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { registerEmailsCommands } from "../../commands/emails";
import { bento } from "../../core/sdk";
import type { EmailRender, EmailTest } from "../../types/agentic";
import { type Harness, createHarness } from "../command-harness";

function makeRender(overrides: Partial<EmailRender["attributes"]> = {}): EmailRender {
  return {
    id: "render",
    type: "email_render",
    attributes: {
      valid: true,
      errors: [],
      warnings: [],
      rendered: {
        subject: "Hi Jane",
        preview_text: "Peek",
        html: "<p>Hello Jane</p>",
        text: "Hello Jane",
        from: "Acme <hi@acme.com>",
        to: "jane@example.com",
      },
      rendered_as: "jane@example.com",
      ...overrides,
    },
  };
}

const invalidRender = makeRender({
  valid: false,
  errors: [{ field: "subject", line: 1, message: "Liquid syntax error: unknown tag 'iff'" }],
  warnings: [{ field: "html", message: "Undefined variable: visitor.fist_name" }],
  rendered: null,
});

const testResult: EmailTest = {
  id: "job-1",
  type: "email_test",
  attributes: {
    status: "queued",
    deliveries: [{ to: "me@acme.com", status: "queued", job_id: "j1", queued_at: null }],
    rendered: makeRender().attributes.rendered,
    warnings: [],
  },
};

describe("bento emails render", () => {
  let harness: Harness;
  let tempDir: string;
  let renderSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(process.cwd(), ".tmp-emails-test-"));
    renderSpy = spyOn(bento, "renderEmail").mockResolvedValue(makeRender());
  });

  afterEach(async () => {
    harness.restore();
    renderSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("renders a template and prints status, subject, preview, and text body", async () => {
    harness = createHarness(registerEmailsCommands);
    const code = await harness.run(["emails", "render", "--template-id", "123"]);

    expect(code).toBe(0);
    expect(renderSpy).toHaveBeenCalledWith({ kind: "template", templateId: 123 }, undefined);
    const out = harness.stdout();
    expect(out).toContain("✓ Valid");
    expect(out).toContain("rendered as jane@example.com");
    expect(out).toContain("Subject: Hi Jane");
    expect(out).toContain("Preview: Peek");
    expect(out).toContain("Hello Jane");
    expect(out).not.toContain("<p>");
  });

  it("prints the HTML body with --html and renders as a subscriber", async () => {
    harness = createHarness(registerEmailsCommands);
    await harness.run([
      "emails",
      "render",
      "--broadcast-id",
      "456",
      "--email",
      "jane@example.com",
      "--html",
    ]);

    expect(renderSpy).toHaveBeenCalledWith(
      { kind: "broadcast", broadcastId: 456 },
      "jane@example.com"
    );
    expect(harness.stdout()).toContain("<p>Hello Jane</p>");
  });

  it("reads raw subject + html file and writes --out", async () => {
    const htmlPath = relative(process.cwd(), join(tempDir, "email.html"));
    const outPath = relative(process.cwd(), join(tempDir, "out.html"));
    await writeFile(htmlPath, "<p>Hi {{ visitor.first_name }}</p>");

    harness = createHarness(registerEmailsCommands);
    const code = await harness.run([
      "emails",
      "render",
      "--subject",
      "Hello",
      "--html-file",
      htmlPath,
      "--preview-text",
      "Peek",
      "--out",
      outPath,
    ]);

    expect(code).toBe(0);
    expect(renderSpy).toHaveBeenCalledWith(
      {
        kind: "raw",
        subject: "Hello",
        html: "<p>Hi {{ visitor.first_name }}</p>",
        previewText: "Peek",
      },
      undefined
    );
    expect(await readFile(outPath, "utf8")).toBe("<p>Hello Jane</p>");
  });

  it("exits 1 and lists errors and warnings when Liquid is invalid", async () => {
    renderSpy.mockResolvedValue(invalidRender);
    harness = createHarness(registerEmailsCommands);
    const code = await harness.run(["emails", "render", "--template-id", "123"]);

    expect(code).toBe(1);
    const out = harness.stdout();
    expect(out).toContain("✗ Invalid");
    expect(out).toContain("subject:1 Liquid syntax error: unknown tag 'iff'");
    expect(out).toContain("html Undefined variable: visitor.fist_name");
    expect(out).toContain("Not rendered");
  });

  it("emits a JSON envelope with success=false when invalid", async () => {
    renderSpy.mockResolvedValue(invalidRender);
    harness = createHarness(registerEmailsCommands, "json");
    const code = await harness.run(["emails", "render", "--template-id", "123"]);

    expect(code).toBe(1);
    const payload = harness.json<EmailRender>();
    expect(payload.success).toBe(false);
    expect(payload.error).toBe("Email has Liquid errors.");
    expect(payload.data.attributes.errors).toHaveLength(1);
  });

  it("emits a JSON envelope with success=true when valid", async () => {
    harness = createHarness(registerEmailsCommands, "json");
    const code = await harness.run(["emails", "render", "--template-id", "123"]);

    expect(code).toBe(0);
    const payload = harness.json<EmailRender>();
    expect(payload.success).toBe(true);
    expect(payload.data.attributes.rendered?.subject).toBe("Hi Jane");
  });

  it.each([
    [["--template-id", "1", "--broadcast-id", "2"], "Provide exactly one source"],
    [[], "Provide exactly one source"],
    [["--subject", "Hi"], "Raw emails need both --subject and --html-file"],
    [["--template-id", "abc"], "--template-id must be a positive integer"],
    [["--template-id", "1", "--email", "nope"], "--email must be a valid email address"],
    [["--subject", "Hi", "--html-file", "../outside.html"], "must be within the current"],
  ])("rejects invalid input %p", async (args, message) => {
    harness = createHarness(registerEmailsCommands);
    const code = await harness.run(["emails", "render", ...args]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

describe("bento emails test", () => {
  let harness: Harness;
  let renderSpy: ReturnType<typeof spyOn>;
  let sendSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    renderSpy = spyOn(bento, "renderEmail").mockResolvedValue(makeRender());
    sendSpy = spyOn(bento, "sendTestEmail").mockResolvedValue(testResult);
  });

  afterEach(() => {
    harness.restore();
    renderSpy.mockRestore();
    sendSpy.mockRestore();
  });

  it("sends to the listed recipients and prints deliveries", async () => {
    harness = createHarness(registerEmailsCommands);
    const code = await harness.run([
      "emails",
      "test",
      "--template-id",
      "123",
      "--to",
      "me@acme.com, you@acme.com",
    ]);

    expect(code).toBe(0);
    expect(sendSpy).toHaveBeenCalledWith(
      { kind: "template", templateId: 123 },
      ["me@acme.com", "you@acme.com"],
      undefined
    );
    expect(harness.stdout()).toContain("Test email queued for 1 recipient(s)");
    expect(harness.stdout()).toContain("me@acme.com");
  });

  it("--dry-run renders only and never sends", async () => {
    harness = createHarness(registerEmailsCommands);
    const code = await harness.run([
      "emails",
      "test",
      "--template-id",
      "123",
      "--to",
      "me@acme.com",
      "--dry-run",
    ]);

    expect(code).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(harness.stdout()).toContain("Dry run: would send to me@acme.com");
  });

  it("--dry-run exits 1 when the render is invalid", async () => {
    renderSpy.mockResolvedValue(invalidRender);
    harness = createHarness(registerEmailsCommands, "json");
    const code = await harness.run([
      "emails",
      "test",
      "--template-id",
      "123",
      "--to",
      "me@acme.com",
      "--dry-run",
    ]);

    expect(code).toBe(1);
    const payload = harness.json<{ dryRun: boolean; to: string[] }>();
    expect(payload.success).toBe(false);
    expect(payload.data.dryRun).toBe(true);
    expect(payload.data.to).toEqual(["me@acme.com"]);
  });

  it("emits the send result as JSON", async () => {
    harness = createHarness(registerEmailsCommands, "json");
    await harness.run(["emails", "test", "--template-id", "1", "--to", "me@acme.com"]);

    const payload = harness.json<EmailTest>();
    expect(payload.success).toBe(true);
    expect(payload.data.attributes.deliveries[0].job_id).toBe("j1");
    expect(payload.meta?.count).toBe(1);
  });

  it.each([
    [["--to", "a@x.com,b@x.com,c@x.com,d@x.com,e@x.com,f@x.com"], "at most 5"],
    [["--to", "not-an-email"], "invalid email address(es): not-an-email"],
    [["--to", " , "], "at least one email address"],
  ])("rejects bad recipients %p", async (args, message) => {
    harness = createHarness(registerEmailsCommands);
    const code = await harness.run(["emails", "test", "--template-id", "1", ...args]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("reports API refusals (e.g. disallowed recipient) and exits 1", async () => {
    const { CLIError } = await import("../../core/sdk");
    sendSpy.mockRejectedValue(
      new CLIError("Access denied: Recipient is not allowed", "AUTH_FAILED", 403)
    );
    harness = createHarness(registerEmailsCommands, "json");
    const code = await harness.run(["emails", "test", "--template-id", "1", "--to", "x@gmail.com"]);

    expect(code).toBe(1);
    const payload = harness.json();
    expect(payload.success).toBe(false);
    expect(payload.error).toBe("Access denied: Recipient is not allowed");
  });
});
