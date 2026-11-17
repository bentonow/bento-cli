import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
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
  let spies: Array<ReturnType<typeof spyOn>>;

  beforeEach(() => {
    spies = [
      spyOn(bento, "getSegments").mockResolvedValue([segment]),
      spyOn(bento, "getSegment").mockResolvedValue(segment),
    ];
  });

  afterEach(() => {
    harness.restore();
    for (const spy of spies) spy.mockRestore();
  });

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

  it("reports a missing segment", async () => {
    spies[1].mockRejectedValue(new CLIError("Resource not found.", "NOT_FOUND", 404));
    harness = createHarness(registerSegmentsCommands, "json");
    const code = await harness.run(["segments", "get", "999"]);
    expect(code).toBe(1);
    expect(harness.json().error).toBe("Resource not found.");
  });

  it.each([["create"], ["update"]])(
    "has no %s command (segments are managed in the Bento app)",
    async (name) => {
      harness = createHarness(registerSegmentsCommands);
      await expect(harness.run(["segments", name, "12"])).rejects.toThrow("unknown command");
    }
  );

  it("help says segments are managed in the Bento app", () => {
    harness = createHarness(registerSegmentsCommands);
    const program = new Command();
    registerSegmentsCommands(program);
    const segments = program.commands.find((command) => command.name() === "segments");
    expect(segments?.description()).toContain("Bento app");
    expect(segments?.commands.map((command) => command.name())).toEqual(["list", "get"]);
  });
});
