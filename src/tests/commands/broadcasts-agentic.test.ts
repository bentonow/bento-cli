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

const STORED_SEND_AT = "2099-12-01T09:00:00.000Z";

function makeTag(name: string) {
  return { id: name, type: "tag", attributes: { name, created_at: "", discarded_at: null } };
}

let tagsSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  tagsSpy = spyOn(bento, "getTags").mockResolvedValue(
    ["vip", "beta", "churned", "VIP Customers"].map(makeTag) as never
  );
});
afterEach(() => {
  tagsSpy.mockRestore();
  Reflect.deleteProperty(process.env, "BENTO_AUTO_CONFIRM");
});

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
  let getSpy: ReturnType<typeof spyOn>;
  const scheduled = { ...detail, attributes: { ...detail.attributes, send_at: STORED_SEND_AT } };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(process.cwd(), ".tmp-broadcasts-test-"));
    updateSpy = spyOn(bento, "updateBroadcast").mockResolvedValue(detail);
    confirmSpy = spyOn(safety, "confirmAction").mockResolvedValue(true);
    getSpy = spyOn(bento, "getBroadcast").mockResolvedValue(scheduled);
  });

  afterEach(async () => {
    harness.restore();
    updateSpy.mockRestore();
    confirmSpy.mockRestore();
    getSpy.mockRestore();
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
      "2099-11-20T09:00:00Z",
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
      send_at: "2099-11-20T09:00:00.000Z",
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

  it("asks for confirmation before --approve, showing the stored send time", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", "--approve"]);

    expect(code).toBe(0);
    expect(getSpy).toHaveBeenCalledWith("456");
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^Approve broadcast 456 to send at .+ \(2099-12-01T09:00:00\.000Z\)\?$/
      ),
      { confirm: false }
    );
    expect(updateSpy).toHaveBeenCalledWith("456", { approved: true });
  });

  it("shows the new --send-at in the approval prompt without fetching", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run([
      "broadcasts",
      "update",
      "456",
      "--approve",
      "--send-at",
      "2099-11-20T09:00:00Z",
    ]);

    expect(getSpy).not.toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("(2099-11-20T09:00:00.000Z)"),
      expect.anything()
    );
    expect(updateSpy).toHaveBeenCalledWith("456", {
      send_at: "2099-11-20T09:00:00.000Z",
      approved: true,
    });
  });

  it.each([
    [null, "has no send time"],
    ["2020-01-01T00:00:00Z", "has a send time in the past (2020-01-01T00:00:00Z)"],
  ])("refuses --approve without a future send time (stored %p)", async (stored, message) => {
    getSpy.mockResolvedValue({ ...detail, attributes: { ...detail.attributes, send_at: stored } });
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", "--approve", "--confirm"]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(harness.stderr()).toContain("--approve --send-at");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("explains a 409 for a paused broadcast", async () => {
    updateSpy.mockRejectedValue(
      new CLIError(
        "Request failed (409): This broadcast is paused and can no longer be edited",
        "UNKNOWN",
        409
      )
    );
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", "--name", "x"]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain("This broadcast is paused and can no longer be edited");
    expect(harness.stderr()).toContain("Only draft and scheduled broadcasts can be changed");
  });

  it("rewrites the API's send-time refusal in CLI terms", async () => {
    updateSpy.mockRejectedValue(
      new CLIError(
        "Validation error: This broadcast's send time has passed. Pass a future send_at to approve it",
        "VALIDATION_ERROR",
        422
      )
    );
    harness = createHarness(registerBroadcastsCommands, "json");
    const code = await harness.run([
      "broadcasts",
      "update",
      "456",
      "--approve",
      "--confirm",
      "--send-at",
      "2099-11-20T09:00:00Z",
    ]);

    expect(code).toBe(1);
    expect(harness.json().error).toBe(
      "Validation error: This broadcast's send time has passed. Pass a future --send-at to approve it"
    );
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
    [["--send-at", "2020-01-01T00:00:00Z"], "--send-at must be in the future"],
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
      "2099-11-20T09:00:00Z",
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
      send_at: "2099-11-20T09:00:00.000Z",
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

  it("rejects a past --send-at on create", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run([
      "broadcasts",
      "create",
      "--name",
      "N",
      "--subject",
      "S",
      "--send-at",
      "2020-01-01T00:00:00Z",
    ]);
    expect(code).toBe(1);
    expect(harness.stderr()).toContain("--send-at must be in the future");
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

describe("broadcast tag safety", () => {
  let harness: Harness;
  let createSpy: ReturnType<typeof spyOn>;
  let updateSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    createSpy = spyOn(bento, "createBroadcast").mockResolvedValue({
      results: 1,
      broadcasts: [{ id: 1, name: "N" }],
      failed: 0,
      failures: [],
    });
    updateSpy = spyOn(bento, "updateBroadcast").mockResolvedValue(detail);
  });

  afterEach(() => {
    harness.restore();
    createSpy.mockRestore();
    updateSpy.mockRestore();
  });

  const create = (...args: string[]) => [
    "broadcasts",
    "create",
    "--name",
    "N",
    "--subject",
    "S",
    ...args,
  ];

  it("passes known tags without looking twice or warning", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(create("--include-tags", "vip", "--exclude-tags", "churned"));

    expect(code).toBe(0);
    expect(tagsSpy).toHaveBeenCalledTimes(1);
    expect(harness.stderr()).not.toContain("doesn't exist yet");
  });

  it("skips the tag lookup when no tags are given", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run(create());
    expect(tagsSpy).not.toHaveBeenCalled();
  });

  it("aborts on an unknown exclude tag without --confirm", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(create("--exclude-tags", "chruned"));

    expect(code).toBe(1);
    const err = harness.stderr();
    expect(err).toContain('--exclude-tags "chruned" doesn\'t exist yet');
    expect(err).toContain("so it will exclude nobody");
    expect(err).toContain("re-run with --confirm");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("aborts on an unknown include tag and suggests the case-insensitive match", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", "--include-tags", "VIP"]);

    expect(code).toBe(1);
    const err = harness.stderr();
    expect(err).toContain('"VIP" (did you mean "vip"? names are case-sensitive)');
    expect(err).toContain("the broadcast will match nobody");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("returns a JSON error for unknown tags unless --confirm", async () => {
    harness = createHarness(registerBroadcastsCommands, "json");
    const code = await harness.run(create("--include-tags", "vip,newcomers"));

    expect(code).toBe(1);
    const payload = harness.json();
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('--include-tags "newcomers" doesn\'t exist yet');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("proceeds with --confirm and reports the warnings", async () => {
    harness = createHarness(registerBroadcastsCommands, "json");
    const code = await harness.run(create("--exclude-tags", "chruned", "--confirm"));

    expect(code).toBe(0);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ exclusive_tags: ["chruned"] })
    );
    const meta = harness.json().meta as { warnings?: string[] };
    expect(meta.warnings?.[0]).toContain("will exclude nobody");
  });

  it("proceeds with BENTO_AUTO_CONFIRM and warns in human output", async () => {
    Object.assign(process.env, { BENTO_AUTO_CONFIRM: "true" });
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(["broadcasts", "update", "456", "--exclude-tags", "chruned"]);

    expect(code).toBe(0);
    expect(updateSpy).toHaveBeenCalledWith("456", { exclusive_tags: ["chruned"] });
    expect(harness.stderr()).toContain("will exclude nobody");
  });

  it("does not look up tags when clearing with ''", async () => {
    harness = createHarness(registerBroadcastsCommands);
    await harness.run(["broadcasts", "update", "456", "--exclude-tags", ""]);
    expect(tagsSpy).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledWith("456", { exclusive_tags: [] });
  });

  it("rejects more than 20 tags per flag", async () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`).join(",");
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run(create("--include-tags", many));

    expect(code).toBe(1);
    expect(harness.stderr()).toContain("--include-tags accepts at most 20 tag names (got 21)");
    expect(tagsSpy).not.toHaveBeenCalled();
  });

  it("rejects tag names over 100 characters", async () => {
    harness = createHarness(registerBroadcastsCommands);
    const code = await harness.run([
      "broadcasts",
      "update",
      "456",
      "--exclude-tags",
      "x".repeat(101),
    ]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain("--exclude-tags tag names must be 100 characters or fewer");
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
