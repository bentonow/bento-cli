import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Command } from "commander";

import { registerAuthorsCommands } from "../../commands/authors";
import { registerSegmentsCommands } from "../../commands/segments";
import { CLIError, bento } from "../../core/sdk";
import type { Author, Segment } from "../../types/agentic";
import { type Harness, createHarness } from "../command-harness";

const author: Author = {
  id: "1",
  type: "author",
  attributes: { name: "Jesse", email: "j@acme.com", created_at: null },
};

const query = {
  condition: "AND",
  rules: [
    {
      condition: "AND",
      data: { groupType: "visitor" },
      rules: [
        {
          id: "cached_tag_ids",
          field: "cached_tag_ids",
          type: "string",
          operator: "contains",
          value: "42",
        },
      ],
    },
  ],
};

const segment: Segment = {
  id: "12",
  type: "segment",
  attributes: {
    name: "Engaged VIPs",
    description: "VIPs",
    visitor_event_query: query,
    created_at: null,
  },
};

describe("bento authors list", () => {
  let harness: Harness;
  let listSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    listSpy = spyOn(bento, "getAuthors").mockResolvedValue([author]);
  });

  afterEach(() => {
    harness.restore();
    listSpy.mockRestore();
  });

  it("prints a table of authors", async () => {
    harness = createHarness(registerAuthorsCommands);
    const code = await harness.run(["authors", "list"]);

    expect(code).toBe(0);
    expect(listSpy).toHaveBeenCalledWith(undefined);
    expect(harness.stdout()).toContain("j@acme.com");
  });

  it("emits JSON and forwards --page", async () => {
    harness = createHarness(registerAuthorsCommands, "json");
    await harness.run(["authors", "list", "--page", "2"]);

    expect(listSpy).toHaveBeenCalledWith(2);
    const payload = harness.json<Author[]>();
    expect(payload.data[0].attributes.email).toBe("j@acme.com");
    expect(payload.meta?.count).toBe(1);
  });

  it("rejects a bad --page", async () => {
    harness = createHarness(registerAuthorsCommands);
    const code = await harness.run(["authors", "list", "--page", "-1"]);
    expect(code).toBe(1);
    expect(harness.stderr()).toContain("--page must be a positive integer");
  });
});

describe("bento segments", () => {
  let harness: Harness;
  let tempDir: string;
  let spies: Array<ReturnType<typeof spyOn>>;
  let updateSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(process.cwd(), ".tmp-segments-test-"));
    updateSpy = spyOn(bento, "updateSegment").mockResolvedValue(segment);
    spies = [
      spyOn(bento, "getSegments").mockResolvedValue([segment]),
      spyOn(bento, "getSegment").mockResolvedValue(segment),
      updateSpy,
    ];
  });

  afterEach(async () => {
    harness.restore();
    for (const spy of spies) spy.mockRestore();
    await rm(tempDir, { recursive: true, force: true });
  });

  async function writeQuery(content: unknown): Promise<string> {
    const file = relative(process.cwd(), join(tempDir, "query.json"));
    await writeFile(file, typeof content === "string" ? content : JSON.stringify(content));
    return file;
  }

  it("lists segments", async () => {
    harness = createHarness(registerSegmentsCommands);
    await harness.run(["segments", "list"]);
    expect(harness.stdout()).toContain("Engaged VIPs");
  });

  it("gets a segment with its query", async () => {
    harness = createHarness(registerSegmentsCommands);
    await harness.run(["segments", "get", "12"]);
    expect(harness.stdout()).toContain("Engaged VIPs");
    expect(harness.stdout()).toContain('"operator": "contains"');
    expect(harness.stdout()).toContain('"field": "cached_tag_ids"');
  });

  it("gets a segment as JSON", async () => {
    harness = createHarness(registerSegmentsCommands, "json");
    await harness.run(["segments", "get", "12"]);
    expect(harness.json<Segment>().data.id).toBe("12");
  });

  it("updates only the given fields and emits JSON", async () => {
    harness = createHarness(registerSegmentsCommands, "json");
    await harness.run(["segments", "update", "12", "--description", "New"]);

    expect(updateSpy).toHaveBeenCalledWith("12", { description: "New" });
    expect(harness.json<Segment>().success).toBe(true);
  });

  it("requires a field on update", async () => {
    harness = createHarness(registerSegmentsCommands);
    const code = await harness.run(["segments", "update", "12"]);
    expect(code).toBe(1);
    expect(harness.stderr()).toContain("Nothing to update");
  });

  it.each([
    ["{not json", "Query file is not valid JSON"],
    [[1, 2], "Query file must hold a QueryBuilder group"],
    [{ condition: "AND" }, "Query file must hold a QueryBuilder group"],
    [{ data: { attributes: { visitor_event_query: "{nope" } } }, "must hold a QueryBuilder group"],
  ])("rejects query file %p", async (content, message) => {
    const file = await writeQuery(content);
    harness = createHarness(registerSegmentsCommands);
    const code = await harness.run(["segments", "update", "12", "--query-file", file]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("surfaces server validation errors", async () => {
    updateSpy.mockRejectedValue(
      new CLIError("Validation error: unknown field 'tagz'", "VALIDATION_ERROR", 422)
    );
    harness = createHarness(registerSegmentsCommands, "json");
    const file = await writeQuery(query);
    const code = await harness.run(["segments", "update", "12", "--query-file", file]);

    expect(code).toBe(1);
    expect(harness.json().error).toBe("Validation error: unknown field 'tagz'");
  });

  it("has no create command (segments are created in the Bento app)", async () => {
    harness = createHarness(registerSegmentsCommands);
    await expect(harness.run(["segments", "create", "--name", "X"])).rejects.toThrow(
      "unknown command"
    );
  });

  it("update help says to create segments in the Bento app first", async () => {
    harness = createHarness(registerSegmentsCommands);
    const program = new Command();
    registerSegmentsCommands(program);
    const update = program.commands
      .find((command) => command.name() === "segments")
      ?.commands.find((command) => command.name() === "update");
    expect(update?.description()).toContain("Create segments in the Bento app first");
  });

  it.each([
    ["saved 'segments get --json' output", { success: true, data: segment }],
    [
      "saved raw API output with a string query",
      {
        data: {
          ...segment,
          attributes: { ...segment.attributes, visitor_event_query: JSON.stringify(query) },
        },
      },
    ],
    ["a JSON string of the query", JSON.stringify(JSON.stringify(query))],
  ])("accepts %s as --query-file", async (_label, content) => {
    const file = await writeQuery(content);
    harness = createHarness(registerSegmentsCommands);
    const code = await harness.run(["segments", "update", "12", "--query-file", file]);

    expect(code).toBe(0);
    expect(updateSpy).toHaveBeenCalledWith("12", { visitor_event_query: query });
  });
});
