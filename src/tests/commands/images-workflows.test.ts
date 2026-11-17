import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  DAILY_UPLOAD_LIMIT_MESSAGE,
  MAX_IMAGE_BYTES,
  registerImagesCommands,
} from "../../commands/images";
import { registerWorkflowsCommands } from "../../commands/workflows";
import { CLIError, bento } from "../../core/sdk";
import type { ImageUpload, WorkflowDetail, WorkflowProposal } from "../../types/agentic";
import { type Harness, createHarness } from "../command-harness";

const upload: ImageUpload = {
  id: "img-1",
  type: "image_upload",
  attributes: { url: "https://cdn.bento/hero.png", filename: "hero.png", size: 2 },
};

const workflow: WorkflowDetail = {
  id: "w1",
  type: "workflow",
  attributes: {
    name: "Onboarding",
    status: "live",
    diagram_revision: "0123456789abcdef",
    triggers: [{ id: "trigger_1", type: "trigger", name: "Signed up" }],
    nodes: [{ id: "n_email", type: "sendEmail", name: "Welcome email" }],
  },
};

const proposal: WorkflowProposal = {
  id: "prop_1",
  type: "workflow_proposal",
  attributes: {
    workflow_id: "w1",
    summary: "Add a 2-day wait",
    status: "pending",
    source: "api",
    created_by: { type: "user", id: 7, label: "Jesse" },
    base_revision: "0123456789abcdef",
    created_at: "2026-11-17T00:00:00Z",
    expires_at: "2026-11-24T00:00:00Z",
    review_url: "https://app.bentonow.com/workflows/w1/edit?proposal=prop_1",
    patch: {},
  },
};

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(process.cwd(), ".tmp-images-workflows-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function tempPath(name: string): string {
  return relative(process.cwd(), join(tempDir, name));
}

describe("bento images upload", () => {
  let harness: Harness;
  let uploadSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    uploadSpy = spyOn(bento, "uploadImage").mockResolvedValue(upload);
  });

  afterEach(() => {
    harness.restore();
    uploadSpy.mockRestore();
  });

  it("uploads base64 content and prints the URL", async () => {
    const file = tempPath("hero.png");
    await writeFile(file, "hi");

    harness = createHarness(registerImagesCommands);
    const code = await harness.run(["images", "upload", file]);

    expect(code).toBe(0);
    expect(uploadSpy).toHaveBeenCalledWith({ filename: "hero.png", data: "aGk=" });
    expect(harness.stdout()).toContain("https://cdn.bento/hero.png");
  });

  it("emits JSON", async () => {
    const file = tempPath("hero.png");
    await writeFile(file, "hi");

    harness = createHarness(registerImagesCommands, "json");
    await harness.run(["images", "upload", file]);
    expect(harness.json<ImageUpload>().data.attributes.url).toBe("https://cdn.bento/hero.png");
  });

  it("accepts a file of exactly 1MB", async () => {
    const file = tempPath("exact.png");
    await writeFile(file, "");
    await truncate(file, MAX_IMAGE_BYTES);

    harness = createHarness(registerImagesCommands);
    const code = await harness.run(["images", "upload", file]);

    expect(MAX_IMAGE_BYTES).toBe(1_048_576);
    expect(code).toBe(0);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects 1MB + 1 byte before uploading", async () => {
    const file = tempPath("huge.png");
    await writeFile(file, "");
    await truncate(file, MAX_IMAGE_BYTES + 1);

    harness = createHarness(registerImagesCommands);
    const code = await harness.run(["images", "upload", file]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain("Image file must be 1MB or smaller");
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("shows a friendly message when the daily upload limit is hit", async () => {
    const file = tempPath("hero.png");
    await writeFile(file, "hi");
    uploadSpy.mockRejectedValue(
      new CLIError("Rate limited: Daily image upload limit reached", "RATE_LIMITED", 429)
    );

    harness = createHarness(registerImagesCommands, "json");
    const code = await harness.run(["images", "upload", file]);

    expect(code).toBe(1);
    expect(harness.json().error).toBe(DAILY_UPLOAD_LIMIT_MESSAGE);
  });

  it.each([
    ["notes.txt", "Unsupported image type"],
    ["logo.svg", "Unsupported image type"],
    ["missing.png", "Image file not found"],
  ])("rejects %p", async (name, message) => {
    if (!name.startsWith("missing")) await writeFile(tempPath(name), "x");
    harness = createHarness(registerImagesCommands);
    const code = await harness.run(["images", "upload", tempPath(name)]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it("refuses paths outside the working directory", async () => {
    harness = createHarness(registerImagesCommands);
    const code = await harness.run(["images", "upload", "../secret.png"]);
    expect(code).toBe(1);
    expect(harness.stderr()).toContain("must be within the current working directory");
  });
});

describe("bento workflows", () => {
  let harness: Harness;
  let spies: Array<ReturnType<typeof spyOn>>;
  let proposeSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    proposeSpy = spyOn(bento, "proposeWorkflowChange").mockResolvedValue(proposal);
    spies = [
      spyOn(bento, "getWorkflows").mockResolvedValue([workflow]),
      spyOn(bento, "getWorkflow").mockResolvedValue(workflow),
      spyOn(bento, "getWorkflowProposals").mockResolvedValue([proposal]),
      proposeSpy,
    ];
  });

  afterEach(() => {
    harness.restore();
    for (const spy of spies) spy.mockRestore();
  });

  it("lists workflows", async () => {
    harness = createHarness(registerWorkflowsCommands);
    await harness.run(["workflows", "list"]);
    expect(harness.stdout()).toContain("Onboarding");
  });

  it("gets a workflow with revision and node ids", async () => {
    harness = createHarness(registerWorkflowsCommands);
    await harness.run(["workflows", "get", "w1"]);
    const out = harness.stdout();
    expect(out).toContain("Revision: 0123456789abcdef");
    expect(out).toContain("trigger_1");
    expect(out).toContain("Signed up");
    expect(out).toContain("n_email");
    expect(out).toContain("Welcome email");
  });

  it("gets a workflow as JSON", async () => {
    harness = createHarness(registerWorkflowsCommands, "json");
    await harness.run(["workflows", "get", "w1"]);
    expect(harness.json<WorkflowDetail>().data.attributes.diagram_revision).toBe(
      "0123456789abcdef"
    );
  });

  it("proposes a change and points at the Flow Builder", async () => {
    const patch = {
      add_nodes: [
        {
          id: "n_new1",
          type: "delay",
          config: { delay_interval_count: 2, delay_interval: "days" },
          insert_after: "trigger_1",
        },
      ],
    };
    const file = tempPath("patch.json");
    await writeFile(file, JSON.stringify(patch));

    harness = createHarness(registerWorkflowsCommands);
    const code = await harness.run([
      "workflows",
      "propose",
      "w1",
      "--patch-file",
      file,
      "--summary",
      "Add a 2-day wait",
      "--base-revision",
      "0123456789abcdef",
    ]);

    expect(code).toBe(0);
    expect(proposeSpy).toHaveBeenCalledWith("w1", {
      summary: "Add a 2-day wait",
      patch,
      base_revision: "0123456789abcdef",
    });
    const out = harness.stdout();
    expect(out).toContain("Proposal prop_1 is pending.");
    expect(out).toContain("Review: https://app.bentonow.com/workflows/w1/edit?proposal=prop_1");
    expect(out).toContain("accepts this proposal in the Flow Builder");
  });

  it("proposes as JSON with the accept hint", async () => {
    const file = tempPath("patch.json");
    await writeFile(file, JSON.stringify({ remove_nodes: ["n1"] }));

    harness = createHarness(registerWorkflowsCommands, "json");
    await harness.run(["workflows", "propose", "w1", "--patch-file", file, "--summary", "x"]);

    const payload = harness.json<WorkflowProposal>();
    expect(payload.data.attributes.review_url).toContain("proposal=prop_1");
    expect(payload.meta?.hint).toContain("Flow Builder");
    expect(proposeSpy).toHaveBeenCalledWith("w1", {
      summary: "x",
      patch: { remove_nodes: ["n1"] },
    });
  });

  it.each([
    ["{}", ["--summary", "x"], "Patch has no changes"],
    ['{"remove_nodes":[]}', ["--summary", "x"], "Patch has no changes"],
    ['{"rename_nodes":[]}', ["--summary", "x"], "Unknown patch keys: rename_nodes"],
    ['{"remove_nodes":"n1"}', ["--summary", "x"], "Patch keys must be arrays: remove_nodes"],
    [
      JSON.stringify({ remove_nodes: Array.from({ length: 201 }, (_, i) => `n${i}`) }),
      ["--summary", "x"],
      "more than 200 changes",
    ],
    [
      JSON.stringify({ update_nodes: [{ id: "n1", config: { body: "x".repeat(70_000) } }] }),
      ["--summary", "x"],
      "larger than 64KB",
    ],
    ['{"remove_nodes":["a"]}', ["--summary", "y".repeat(501)], "500 characters or fewer"],
    [
      '{"remove_nodes":["a"]}',
      ["--summary", "x", "--base-revision", "abc"],
      "--base-revision must be the 16-character diagram_revision",
    ],
    ["[]", ["--summary", "x"], "Patch file must contain a JSON object"],
    ["nope", ["--summary", "x"], "Patch file is not valid JSON"],
    ['{"remove_nodes":["a"]}', ["--summary", "  "], "--summary cannot be empty"],
  ])("rejects patch %p", async (content, extra, message) => {
    const file = tempPath("patch.json");
    await writeFile(file, content);

    harness = createHarness(registerWorkflowsCommands);
    const code = await harness.run(["workflows", "propose", "w1", "--patch-file", file, ...extra]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(proposeSpy).not.toHaveBeenCalled();
  });

  it("surfaces server patch validation errors", async () => {
    const file = tempPath("patch.json");
    await writeFile(file, '{"remove_nodes":["ghost"]}');
    proposeSpy.mockRejectedValue(
      new CLIError("Validation error: node ghost not found", "VALIDATION_ERROR", 422)
    );

    harness = createHarness(registerWorkflowsCommands, "json");
    const code = await harness.run([
      "workflows",
      "propose",
      "w1",
      "--patch-file",
      file,
      "--summary",
      "x",
    ]);

    expect(code).toBe(1);
    expect(harness.json().error).toBe("Validation error: node ghost not found");
  });

  it("explains a stale base revision (409) and how to recover", async () => {
    const file = tempPath("patch.json");
    await writeFile(file, '{"remove_nodes":["n1"]}');
    proposeSpy.mockRejectedValue(
      new CLIError("Request failed (409): The flow changed since base_revision", "UNKNOWN", 409, {
        error: "The flow changed since base_revision",
        errors: ["base_revision ..."],
        revision: "fedcba9876543210",
      })
    );

    harness = createHarness(registerWorkflowsCommands);
    const code = await harness.run([
      "workflows",
      "propose",
      "w1",
      "--patch-file",
      file,
      "--summary",
      "x",
      "--base-revision",
      "0123456789abcdef",
    ]);

    expect(code).toBe(1);
    const err = harness.stderr();
    expect(err).toContain(
      "The flow changed since revision 0123456789abcdef (now fedcba9876543210)"
    );
    expect(err).toContain("bento workflows get w1");
    expect(err).toContain("--base-revision fedcba9876543210");
  });

  it("prints validator warnings and warns that moves are not applied", async () => {
    const file = tempPath("patch.json");
    await writeFile(file, '{"move_nodes":[{"id":"n1","move_after":"n2"}]}');
    proposeSpy.mockResolvedValue({
      ...proposal,
      attributes: { ...proposal.attributes, warnings: ["Corrected insert_after for n_new1"] },
    });

    harness = createHarness(registerWorkflowsCommands);
    const code = await harness.run([
      "workflows",
      "propose",
      "w1",
      "--patch-file",
      file,
      "--summary",
      "x",
    ]);

    expect(code).toBe(0);
    const err = harness.stderr();
    expect(err).toContain("move_nodes is accepted but the Flow Builder does not apply moves yet");
    expect(err).toContain("Corrected insert_after for n_new1");
  });

  it("accepts camelCase patch keys", async () => {
    const file = tempPath("patch.json");
    await writeFile(file, '{"removeNodes":["n1"]}');
    harness = createHarness(registerWorkflowsCommands);
    const code = await harness.run([
      "workflows",
      "propose",
      "w1",
      "--patch-file",
      file,
      "--summary",
      "x",
    ]);
    expect(code).toBe(0);
  });

  it("lists proposals", async () => {
    harness = createHarness(registerWorkflowsCommands);
    await harness.run(["workflows", "proposals", "w1"]);
    const out = harness.stdout();
    expect(out).toContain("SUMMARY");
    expect(out).toContain(
      "prop_1 (by Jesse): https://app.bentonow.com/workflows/w1/edit?proposal=prop_1"
    );
  });

  it("lists proposals as JSON", async () => {
    harness = createHarness(registerWorkflowsCommands, "json");
    await harness.run(["workflows", "proposals", "w1"]);
    expect(harness.json<WorkflowProposal[]>().meta?.count).toBe(1);
  });
});
