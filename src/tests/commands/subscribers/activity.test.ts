import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { registerSubscribersCommands } from "../../../commands/subscribers";
import { CLIError, bento } from "../../../core/sdk";
import type { SubscriberActivity } from "../../../types/agentic";
import { type Harness, createHarness } from "../../command-harness";

const activity: SubscriberActivity = {
  id: "v-1",
  type: "subscriber_activity",
  attributes: {
    email: "jane@example.com",
    uuid: "v-1",
    summary: {
      event_count: 412,
      last_event_at: "2026-11-16T09:12:00Z",
      last_email_opened_at: null,
      last_email_clicked_at: "2026-11-10T08:00:00Z",
      last_visit_at: null,
      last_engagement: { type: "$click", at: "2026-11-16T09:12:00Z" },
    },
    recent_events: [
      {
        uuid: "e1",
        type: "$click",
        happened_at: "2026-11-16T09:12:00Z",
        data: { url: "https://acme.com" },
      },
    ],
  },
};

describe("bento subscribers activity", () => {
  let harness: Harness;
  let activitySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    activitySpy = spyOn(bento, "getSubscriberActivity").mockResolvedValue(activity);
  });

  afterEach(() => {
    harness.restore();
    activitySpy.mockRestore();
  });

  it("prints the summary block and recent events", async () => {
    harness = createHarness(registerSubscribersCommands);
    const code = await harness.run(["subscribers", "activity", "jane@example.com"]);

    expect(code).toBe(0);
    expect(activitySpy).toHaveBeenCalledWith({ email: "jane@example.com" }, undefined);
    const out = harness.stdout();
    expect(out).toContain("Subscriber: jane@example.com (v-1)");
    expect(out).toContain("Events:            412");
    expect(out).toContain("Last email opened: —");
    expect(out).toContain("Last engagement:   $click at");
    expect(out).toContain("$click");
    expect(out).toContain("https://acme.com");
  });

  it("looks up by --uuid with --limit", async () => {
    harness = createHarness(registerSubscribersCommands);
    await harness.run(["subscribers", "activity", "--uuid", "v-1", "--limit", "50"]);

    expect(activitySpy).toHaveBeenCalledWith({ uuid: "v-1" }, 50);
  });

  it("emits the activity resource as JSON", async () => {
    harness = createHarness(registerSubscribersCommands, "json");
    await harness.run(["subscribers", "activity", "jane@example.com"]);

    const payload = harness.json<SubscriberActivity>();
    expect(payload.success).toBe(true);
    expect(payload.data.attributes.summary.event_count).toBe(412);
    expect(payload.meta?.count).toBe(1);
  });

  it.each([
    [[], "Provide a subscriber email or --uuid"],
    [["jane@example.com", "--uuid", "v-1"], "not both"],
    [["jane@example.com", "--limit", "0"], "--limit must be a positive integer"],
    [["jane@example.com", "--limit", "101"], "--limit must be between 1 and 100"],
  ])("rejects %p", async (args, message) => {
    harness = createHarness(registerSubscribersCommands);
    const code = await harness.run(["subscribers", "activity", ...args]);

    expect(code).toBe(1);
    expect(harness.stderr()).toContain(message);
    expect(activitySpy).not.toHaveBeenCalled();
  });

  it("reports a missing subscriber as a JSON error", async () => {
    activitySpy.mockRejectedValue(new CLIError("Resource not found.", "NOT_FOUND", 404));
    harness = createHarness(registerSubscribersCommands, "json");
    const code = await harness.run(["subscribers", "activity", "nobody@example.com"]);

    expect(code).toBe(1);
    expect(harness.json().error).toBe("Resource not found.");
  });
});
