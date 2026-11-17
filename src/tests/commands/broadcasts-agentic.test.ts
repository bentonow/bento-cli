import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { registerBroadcastsCommands } from "../../commands/broadcasts";
import { safety } from "../../core/safety";
import { CLIError, bento } from "../../core/sdk";
import type { BroadcastDetail } from "../../types/agentic";
import { type Harness, createHarness } from "../command-harness";

const detail: BroadcastDetail = {
  id: "456",
  type: "broadcast",
  attributes: {
    name: "November news",
    status: "draft",
    subject: "Hi {{ visitor.first_name }}",
    preview_text: "Peek",
    html: "<p>Hi</p>",
    template_id: 789,
    author: { id: 1, name: "Jesse", email: "j@acme.com" },
    audience: {
      segment_ids: [12],
      inclusive_tags: ["vip"],
      exclusive_tags: ["churned"],
      visitor_query: null,
    },
    send_at: null,
    approved_at: null,
    batch_size_per_hour: 1000,
    created_at: "2026-11-01T00:00:00Z",
    sent_final_batch_at: null,
    share_url: "https://acme.bentonow.com/b/456",
    stats: null,
  },
};

describe("bento broadcasts get", () => {
  let harness: Harness;
  let getSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    getSpy = spyOn(bento, "getBroadcast").mockResolvedValue(detail);
  });

  afterEach(() => {
    harness.restore();
    getSpy.mockRestore();
  });

  it("prints the broadcast fields", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "get", "456"]);

    expect(code).toBe(0);
    expect(getSpy).toHaveBeenCalledWith("456");
    const out = harness.stdout();
    expect(out).toContain("November news");
    expect(out).toContain("draft");
    expect(out).toContain("Jesse <j@acme.com> (id 1)");
    expect(out).toContain("vip");
    expect(out).toContain("churned");
  });

  it("emits JSON", async () => {
    harness = createHarness(registerBroadcastsCommands, "json");
    await harness.run(["broadcasts", "get", "456"]);

    const payload = harness.json<BroadcastDetail>();
    expect(payload.success).toBe(true);
    expect(payload.data.attributes.audience?.segment_ids).toEqual([12]);
  });

  it("reports not found", async () => {
    getSpy.mockRejectedValue(new CLIError("Resource not found.", "NOT_FOUND", 404));
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "get", "999"]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain("Resource not found.");
  });
});

describe("bento broadcasts update", () => {
  let harness: Harness;
  let tempDir: string;
  let updateSpy: ReturnType<typeof spyOn>;
  let confirmSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(process.cwd(), ".tmp-broadcasts-test-"));
    updateSpy = spyOn(bento, "updateBroadcast").mockResolvedValue(detail);
    confirmSpy = spyOn(safety, "confirmAction").mockResolvedValue(true);
  });

  afterEach(async () => {
    harness.restore();
    updateSpy.mockRestore();
    confirmSpy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("sends every supported field", async () => {
    const htmlPath = relative(process.cwd(), join(tempDir, "body.html"));
    await writeFile(htmlPath, "<p>New</p>");

    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run([
      "broadcasts",
      "update",
      "456",
      "--name",
      "Renamed",
      "--subject",
      "New subject",
      "--html-file",
      htmlPath,
      "--type",
      "raw",
      "--preview-text",
      "Peek",
      "--author-id",
      "2",
      "--segment-id",
      "12",
      "--include-tags",
      "vip, beta",
      "--exclude-tags",
      "churned",
      "--send-at",
      "2026-11-20T09:00:00Z",
      "--batch-size",
      "500",
    ]);

    expect(code).toBe(0);
    expect(updateSpy).toHaveBeenCalledWith("456", {
      name: "Renamed",
      subject: "New subject",
      content: "<p>New</p>",
      type: "raw",
      preview_text: "Peek",
      author_id: 2,
      segment_id: 12,
      inclusive_tags: ["vip", "beta"],
      exclusive_tags: ["churned"],
      send_at: "2026-11-20T09:00:00.000Z",
      batch_size_per_hour: 500,
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(harness.stdout()).toContain("Updated broadcast 456");
  });

  it("clears segment and tags with 'none' and ''", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run([
      "broadcasts",
      "update",
      "456",
      "--segment-id",
      "none",
      "--include-tags",
      "",
    ]);

    expect(updateSpy).toHaveBeenCalledWith("456", { segment_id: null, inclusive_tags: [] });
  });

  it("asks for confirmation before --approve", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", "--approve"]);

    expect(code).toBe(0);
    expect(confirmSpy).toHaveBeenCalledWith("Approve broadcast 456 for sending?", {
      confirm: false,
    });
    expect(updateSpy).toHaveBeenCalledWith("456", { approved: true });
  });

  it("passes --confirm through to the safety prompt", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run(["broadcasts", "update", "456", "--approve", "--confirm"]);

    expect(confirmSpy).toHaveBeenCalledWith(expect.any(String), { confirm: true });
  });

  it("does not approve when confirmation is declined", async () => {
    confirmSpy.mockResolvedValue(false);
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", "--approve"]);

    expect(code).toBe(1);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(harness.stderr()).toContain("Approval cancelled; broadcast unchanged.");
  });

  it("sends --type alone to switch the editor", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run(["broadcasts", "update", "456", "--type", "plain"]);
    expect(updateSpy).toHaveBeenCalledWith("456", { type: "plain" });
  });

  it("--unapprove skips the prompt", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run(["broadcasts", "update", "456", "--unapprove"]);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith("456", { approved: false });
  });

  it("emits JSON with the updated fields", async () => {
    harness = createHarness(registerBroadcastsCommands, "json");
    await harness.run(["broadcasts", "update", "456", "--name", "Renamed"]);

    const payload = harness.json<BroadcastDetail>();
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe("456");
    const meta = payload.meta as { updatedFields?: string[] };
    expect(meta.updatedFields).toEqual(["name"]);
  });

  it.each([
    [[], "Nothing to update"],
    [["--approve", "--unapprove"], "only one of --approve or --unapprove"],
    [["--type", "fancy"], "--type must be one of: plain, raw"],
    [["--batch-size", "9"], "--batch-size must be between 10 and 500000"],
    [["--batch-size", "500001"], "--batch-size must be between 10 and 500000"],
    [["--author-id", "x"], "--author-id must be a positive integer"],
    [["--send-at", "next tuesday"], "--send-at must be an ISO 8601 timestamp"],
    [["--batch-size", "0"], "--batch-size must be a positive integer"],
  ])("rejects %p", async (args, message) => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", ...args]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("surfaces 409 for non-editable broadcasts", async () => {
    updateSpy.mockRejectedValue(
      new CLIError("Request failed (409): Broadcast is not editable", "UNKNOWN", 409)
    );
    harness = createHarness(registerBroadcastsCommands, "json");
    const code = await harness.run(["broadcasts", "update", "456", "--name", "x"]);

    expect(code).toBe(1);
    expect(harness.json().error).toBe("Request failed (409): Broadcast is not editable");
  });
});

describe("bento broadcasts create (new flags)", () => {
  let harness: Harness;
  let createSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    createSpy = spyOn(bento, "createBroadcast").mockResolvedValue({
      results: 1,
      broadcasts: [{ id: 1, name: "N" }],
      failed: 0,
      failures: [],
    });
  });

  afterEach(() => {
    harness.restore();
    createSpy.mockRestore();
  });

  it("sends tag arrays, author, segment, preview text, and schedule", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run([
      "broadcasts",
      "create",
      "--name",
      "N",
      "--subject",
      "S",
      "--include-tags",
      "vip,beta",
      "--exclude-tags",
      "churned",
      "--author-id",
      "3",
      "--segment-id",
      "12",
      "--preview-text",
      "Peek",
      "--send-at",
      "2026-11-20T09:00:00Z",
    ]);

    expect(code).toBe(0);
    expect(createSpy).toHaveBeenCalledWith({
      name: "N",
      subject: "S",
      content: "",
      type: "html",
      batch_size_per_hour: 1000,
      inclusive_tags: ["vip", "beta"],
      exclusive_tags: ["churned"],
      preview_text: "Peek",
      author_id: 3,
      segment_id: 12,
      send_at: "2026-11-20T09:00:00.000Z",
    });
  });

  it("keeps sending `from` when no author is given", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run(["broadcasts", "create", "--name", "N", "--subject", "S"]);

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ from: { name: "", email: "" } })
    );
  });

  it("emits JSON", async () => {
    harness = createHarness(registerBroadcastsCommands, "json");
    await harness.run(["broadcasts", "create", "--name", "N", "--subject", "S"]);

    expect(harness.json().success).toBe(true);
  });

  it.each([
    [["--batch-size", "5"], "Batch size must be between 10 and 500000"],
    [["--from-email", "a@acme.com", "--author-id", "3"], "Use either --from-email or --author-id"],
  ])("rejects create flags %p", async (args, message) => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run([
      "broadcasts",
      "create",
      "--name",
      "N",
      "--subject",
      "S",
      ...args,
    ]);
    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric segment id", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run([
      "broadcasts",
      "create",
      "--name",
      "N",
      "--subject",
      "S",
      "--segment-id",
      "abc",
    ]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain("--segment-id must be a positive integer");
    expect(createSpy).not.toHaveBeenCalled();
  });
});
