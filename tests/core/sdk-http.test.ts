import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { config } from "../../src/core/config";
import { BentoClient, CLIError, extractApiErrorDetail } from "../../src/core/sdk";

const profile = {
  publishableKey: "pub",
  secretKey: "sec",
  siteUuid: "site-123",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

interface RecordedRequest {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BentoClient HTTP helpers", () => {
  let client: BentoClient;
  let requests: RecordedRequest[];
  let nextResponse: () => Response;
  let fetchSpy: ReturnType<typeof spyOn>;
  let profileSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    client = new BentoClient();
    requests = [];
    nextResponse = () => jsonResponse({ data: { id: "1", type: "x", attributes: {} } });
    profileSpy = spyOn(config, "getCurrentProfile").mockResolvedValue(profile);
    fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      requests.push({
        method: init?.method ?? "GET",
        url: new URL(String(input)),
        body: init?.body ? JSON.parse(String(init.body)) : null,
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return nextResponse();
    }) as typeof fetch);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    profileSpy.mockRestore();
  });

  function lastRequest(): RecordedRequest {
    const request = requests.at(-1);
    if (!request) throw new Error("no request recorded");
    return request;
  }

  describe("apiPatch", () => {
    it("sends PATCH with JSON body, site_uuid in body, and basic auth", async () => {
      await client.updateBroadcast("456", { name: "New", inclusive_tags: ["vip"] });

      const request = lastRequest();
      expect(request.method).toBe("PATCH");
      expect(request.url.pathname).toBe("/api/v1/fetch/broadcasts/456");
      expect(request.url.searchParams.get("site_uuid")).toBeNull();
      expect(request.body).toEqual({
        site_uuid: "site-123",
        broadcast: { name: "New", inclusive_tags: ["vip"] },
      });
      expect(request.headers["Content-Type"]).toBe("application/json");
      expect(request.headers.Authorization).toBe(
        `Basic ${Buffer.from("pub:sec").toString("base64")}`
      );
    });

    it("surfaces the API error message for 409 conflicts", async () => {
      nextResponse = () => jsonResponse({ error: "Broadcast is not editable (sent)" }, 409);

      const error = await client.updateBroadcast("456", { name: "x" }).catch((e) => e);
      expect(error).toBeInstanceOf(CLIError);
      expect(error.message).toBe("Request failed (409): Broadcast is not editable (sent)");
      expect(error.statusCode).toBe(409);
    });

    it("keeps validation details for 422 without double-wrapping", async () => {
      nextResponse = () =>
        jsonResponse(
          {
            error: "Liquid is invalid",
            errors: [{ field: "subject", line: 1, message: "Unknown tag 'iff'" }],
          },
          422
        );

      const error = await client.updateBroadcast("1", { approved: true }).catch((e) => e);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe(
        "Validation error: Liquid is invalid; subject:1 Unknown tag 'iff'"
      );
    });
  });

  describe("GET endpoints", () => {
    it("getSubscriberActivity sends email and limit as query params", async () => {
      await client.getSubscriberActivity({ email: "jane@example.com" }, 10);

      const request = lastRequest();
      expect(request.method).toBe("GET");
      expect(request.url.pathname).toBe("/api/v1/fetch/subscribers/activity");
      expect(request.url.searchParams.get("site_uuid")).toBe("site-123");
      expect(request.url.searchParams.get("email")).toBe("jane@example.com");
      expect(request.url.searchParams.get("limit")).toBe("10");
      expect(request.url.searchParams.has("uuid")).toBe(false);
    });

    it("getSubscriberActivity can look up by uuid", async () => {
      await client.getSubscriberActivity({ uuid: "abc" });
      const params = lastRequest().url.searchParams;
      expect(params.get("uuid")).toBe("abc");
      expect(params.has("email")).toBe(false);
      expect(params.has("limit")).toBe(false);
    });

    it("unwraps the data envelope", async () => {
      nextResponse = () =>
        jsonResponse({ data: { id: "456", type: "broadcast", attributes: { name: "Hi" } } });
      const broadcast = await client.getBroadcast("456");
      expect(broadcast).toEqual({
        id: "456",
        type: "broadcast",
        attributes: { name: "Hi" },
      } as never);
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/broadcasts/456");
    });

    it("includes the API error detail on 404", async () => {
      nextResponse = () => jsonResponse({ error: "Subscriber not found" }, 404);
      const error = await client.getSubscriberActivity({ email: "x@y.com" }).catch((e) => e);
      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).toBe("Resource not found. Subscriber not found");
    });

    it("lists accept both {data: []} and bare arrays", async () => {
      nextResponse = () => jsonResponse({ data: [{ id: "1", type: "author", attributes: {} }] });
      expect(await client.getAuthors()).toHaveLength(1);
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/authors");

      nextResponse = () => jsonResponse([{ id: "2", type: "segment", attributes: {} }]);
      expect(await client.getSegments(2)).toHaveLength(1);
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/segments");
      expect(lastRequest().url.searchParams.get("page")).toBe("2");
    });

    it("routes workflow and segment reads", async () => {
      await client.getSegment("12");
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/segments/12");

      nextResponse = () => jsonResponse({ data: [] });
      await client.getWorkflows();
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/workflows");

      nextResponse = () => jsonResponse({ data: { id: "w1", type: "workflow", attributes: {} } });
      await client.getWorkflow("w1");
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/workflows/w1");

      nextResponse = () => jsonResponse({ data: [] });
      await client.getWorkflowProposals("w1");
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/workflows/w1/proposals");
    });

    it("parses the segment query JSON string GET returns", async () => {
      const query = { condition: "AND", rules: [] };
      nextResponse = () =>
        jsonResponse({
          data: {
            id: "12",
            type: "segment",
            attributes: { name: "S", visitor_event_query: JSON.stringify(query) },
          },
        });
      const segment = await client.getSegment("12");
      expect(segment.attributes.visitor_event_query).toEqual(query);
    });

    it("resolves a relative proposal review_url against the app host", async () => {
      nextResponse = () =>
        jsonResponse({
          data: [
            {
              id: "prop_1",
              type: "workflow_proposal",
              attributes: { review_url: "/account/workflows/42/edit?proposal=prop_1" },
            },
          ],
        });
      const [proposal] = await client.getWorkflowProposals("42");
      expect(proposal.attributes.review_url).toBe(
        "https://app.bentonow.com/account/workflows/42/edit?proposal=prop_1"
      );
    });

    it("keeps the parsed error body on CLIError (409 stale revision)", async () => {
      nextResponse = () =>
        jsonResponse(
          { error: "The flow changed since base_revision", errors: ["x"], revision: "abc" },
          409
        );
      const error = await client
        .proposeWorkflowChange("42", { summary: "s", patch: { remove_nodes: ["a"] } })
        .catch((e) => e);
      expect(error.statusCode).toBe(409);
      expect(error.body.revision).toBe("abc");
    });

    it("rejects an empty data envelope", async () => {
      nextResponse = () => jsonResponse({});
      const error = await client.getBroadcast("1").catch((e) => e);
      expect(error).toBeInstanceOf(CLIError);
      expect(error.message).toContain("empty response");
    });
  });

  describe("POST endpoints", () => {
    it("renderEmail sends a template source", async () => {
      await client.renderEmail({ kind: "template", templateId: 123 });
      const request = lastRequest();
      expect(request.method).toBe("POST");
      expect(request.url.pathname).toBe("/api/v1/fetch/emails/render");
      expect(request.body).toEqual({ site_uuid: "site-123", template_id: 123 });
    });

    it("renderEmail sends raw content and the subscriber to render as", async () => {
      await client.renderEmail(
        {
          kind: "raw",
          subject: "Hi {{ visitor.first_name }}",
          html: "<p>x</p>",
          previewText: "p",
          type: "plain",
        },
        "jane@example.com"
      );
      expect(lastRequest().body).toEqual({
        site_uuid: "site-123",
        subject: "Hi {{ visitor.first_name }}",
        html: "<p>x</p>",
        preview_text: "p",
        type: "plain",
        email: "jane@example.com",
      });
    });

    it("sendTestEmail sends recipients as an array", async () => {
      await client.sendTestEmail({ kind: "broadcast", broadcastId: 456 }, ["me@acme.com"]);
      const request = lastRequest();
      expect(request.url.pathname).toBe("/api/v1/fetch/emails/test");
      expect(request.body).toEqual({
        site_uuid: "site-123",
        broadcast_id: 456,
        to: ["me@acme.com"],
      });
    });

    it("sendTestEmail surfaces 403 recipient errors", async () => {
      nextResponse = () => jsonResponse({ error: "Recipient is not a team member" }, 403);
      const error = await client
        .sendTestEmail({ kind: "template", templateId: 1 }, ["x@gmail.com"])
        .catch((e) => e);
      expect(error.code).toBe("AUTH_FAILED");
      expect(error.message).toBe("Access denied: Recipient is not a team member");
    });

    it("sendTestEmail surfaces the daily limit on 429", async () => {
      nextResponse = () => jsonResponse({ error: "Daily preview limit reached" }, 429);
      const error = await client
        .sendTestEmail({ kind: "template", templateId: 1 }, ["me@acme.com"])
        .catch((e) => e);
      expect(error.code).toBe("RATE_LIMITED");
      expect(error.message).toBe("Rate limited: Daily preview limit reached");
    });

    it("createBroadcast sends tag arrays and new fields", async () => {
      nextResponse = () => jsonResponse({ results: 1, failed: 0, broadcasts: [], failures: [] });
      await client.createBroadcast({
        name: "N",
        subject: "S",
        content: "",
        type: "html",
        batch_size_per_hour: 1000,
        inclusive_tags: ["vip", "beta"],
        author_id: 3,
        preview_text: "Preview",
      });
      expect(lastRequest().url.pathname).toBe("/api/v1/batch/broadcasts");
      expect(lastRequest().body).toEqual({
        site_uuid: "site-123",
        broadcasts: [
          {
            name: "N",
            subject: "S",
            content: "",
            type: "html",
            batch_size_per_hour: 1000,
            inclusive_tags: ["vip", "beta"],
            author_id: 3,
            preview_text: "Preview",
          },
        ],
      });
    });

    it("createSegment and updateSegment wrap the input in `segment`", async () => {
      const query = { condition: "AND", rules: [] };
      await client.createSegment({ name: "VIPs", visitor_event_query: query });
      expect(lastRequest().method).toBe("POST");
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/segments");
      expect(lastRequest().body).toEqual({
        site_uuid: "site-123",
        segment: { name: "VIPs", visitor_event_query: query },
      });

      await client.updateSegment("12", { description: "d" });
      expect(lastRequest().method).toBe("PATCH");
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/segments/12");
      expect(lastRequest().body).toEqual({ site_uuid: "site-123", segment: { description: "d" } });
    });

    it("uploadImage posts base64 JSON", async () => {
      await client.uploadImage({ filename: "hero.png", data: "aGk=" });
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/uploads/images");
      expect(lastRequest().body).toEqual({
        site_uuid: "site-123",
        filename: "hero.png",
        data: "aGk=",
      });
    });

    it("proposeWorkflowChange wraps the proposal", async () => {
      const patch = {
        add_nodes: [{ id: "n1", type: "delay", config: {}, insert_after: "trigger" }],
      };
      await client.proposeWorkflowChange("w1", { summary: "Add wait", patch, base_revision: "r1" });
      expect(lastRequest().url.pathname).toBe("/api/v1/fetch/workflows/w1/proposals");
      expect(lastRequest().body).toEqual({
        site_uuid: "site-123",
        proposal: { summary: "Add wait", patch, base_revision: "r1" },
      });
    });
  });

  it("encodes path ids", async () => {
    await client.getBroadcast("a/b");
    expect(lastRequest().url.pathname).toBe("/api/v1/fetch/broadcasts/a%2Fb");
  });
});

describe("extractApiErrorDetail", () => {
  it("returns null for non-JSON bodies", () => {
    expect(extractApiErrorDetail("Internal Server Error")).toBeNull();
  });

  it("joins error and string errors", () => {
    expect(extractApiErrorDetail(JSON.stringify({ error: "Bad", errors: ["a", "b"] }))).toBe(
      "Bad; a; b"
    );
  });

  it("returns null when the body has no error fields", () => {
    expect(extractApiErrorDetail(JSON.stringify({ ok: true }))).toBeNull();
  });
});
