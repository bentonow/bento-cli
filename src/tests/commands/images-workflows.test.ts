import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { MAX_IMAGE_BYTES, registerImagesCommands } from "../../commands/images";
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
    diagram_revision: "rev-abc",
    nodes: [{ id: "n_trigger", type: "trigger", name: "Signed up" }],
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
    base_revision: "rev-abc",
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

  it("rejects files over 10MB before uploading", async () => {
    const file = tempPath("huge.png");
    await writeFile(file, "");
    await truncate(file, MAX_IMAGE_BYTES + 1);

    harness = createHarness(registerImagesCommands);
    const code = await harness.run(["images", "upload", file]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(`Image file must be under ${MAX_IMAGE_BYTES} bytes`);
    expect(uploadSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["notes.txt", "Unsupported image type"],
    ["missing.png", "Image file not found"],
  ])("rejects %p", async (name, message) => {
    if (name.endsWith(".txt")) await writeFile(tempPath(name), "x");
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
    expect(out).toContain("Revision: rev-abc");
    expect(out).toContain("n_trigger");
    expect(out).toContain("Signed up");
  });

  it("gets a workflow as JSON", async () => {
    harness = createHarness(registerWorkflowsCommands, "json");
    await harness.run(["workflows", "get", "w1"]);
    expect(harness.json<WorkflowDetail>().data.attributes.diagram_revision).toBe("rev-abc");
  });

  it("proposes a change and points at the Flow Builder", async () => {
    const patch = { add_nodes: [{ id: "n_new1", type: "delay", data: {} }] };
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
      "rev-abc",
    ]);

    expect(code).toBe(0);
    expect(proposeSpy).toHaveBeenCalledWith("w1", {
      summary: "Add a 2-day wait",
      patch,
      base_revision: "rev-abc",
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
    ["{}", ["--summary", "x"], "Patch file is empty"],
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

  it("lists proposals", async () => {
    harness = createHarness(registerWorkflowsCommands);
    await harness.run(["workflows", "proposals", "w1"]);
    const out = harness.stdout();
    expect(out).toContain("SUMMARY");
    expect(out).toContain("prop_1: https://app.bentonow.com/workflows/w1/edit?proposal=prop_1");
  });

  it("lists proposals as JSON", async () => {
    harness = createHarness(registerWorkflowsCommands, "json");
    await harness.run(["workflows", "proposals", "w1"]);
    expect(harness.json<WorkflowProposal[]>().meta?.count).toBe(1);
  });
});
