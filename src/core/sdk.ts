/**
 * Bento Node SDK wrapper
 *
 * All API operations go through this module to:
 * - Centralize auth/profile handling
 * - Provide consistent error transformation
 * - Enable easy mocking in tests
 * - Add logging, rate limiting, retries
 *
 * Commands should NEVER instantiate the SDK directly.
 */

import { Analytics } from "@bentonow/bento-node-sdk";
import {
  NotAuthorizedError,
  RateLimitedError,
  RequestTimeoutError,
} from "@bentonow/bento-node-sdk";
import type {
  Author,
  BroadcastCreate,
  BroadcastDetail,
  BroadcastUpdate,
  EmailRender,
  EmailSource,
  EmailTest,
  ImageUpload,
  ImageUploadInput,
  Segment,
  SegmentInput,
  SubscriberActivity,
  SubscriberLookup,
  WorkflowDetail,
  WorkflowProposal,
  WorkflowProposalInput,
  WorkflowSummary,
} from "../types/agentic";
import type { BentoProfile } from "../types/config";
import type {
  AddFieldParams,
  Broadcast,
  BroadcastCreateResult,
  CreateSequenceEmailInput,
  EmailTemplate,
  Field,
  GetSubscriberParams,
  ImportResult,
  ImportSubscribersParams,
  SDKErrorCode,
  Sequence,
  SiteStats,
  Subscriber,
  SubscriberSearchParams,
  SubscriberSearchResult,
  Tag,
  TagSubscriberParams,
  TrackEventParams,
  UpdateSequenceEmailInput,
} from "../types/sdk";
import { normalizeSegment } from "../utils/segment-query";
import {
  type ResolveSequenceIdResult,
  isSequenceId,
  resolveSequenceId,
} from "../utils/sequence-identity";
import { config } from "./config";

/**
 * CLI-specific error class with error codes
 *
 * Provides user-friendly error messages with machine-readable codes
 * for consistent error handling across commands.
 */
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: SDKErrorCode,
    public readonly statusCode?: number,
    /** Parsed JSON error body from the API, when there was one. */
    public readonly body?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CLIError";
  }
}

/**
 * BentoClient wrapper class
 *
 * Lazily initializes the SDK with credentials from the active profile.
 * Provides typed methods for common operations with consistent error handling.
 */
export class BentoClient {
  private sdk: Analytics | null = null;
  private profile: BentoProfile | null = null;
  private readonly apiBaseUrl = BentoClient.validateApiBaseUrl(
    process.env.BENTO_API_BASE_URL ?? "https://app.bentonow.com/api/v1"
  );

  /**
   * Get or create SDK instance with current profile credentials
   */
  async getClient(): Promise<Analytics> {
    if (this.sdk) {
      return this.sdk;
    }

    const currentProfile = await config.getCurrentProfile();
    if (!currentProfile) {
      throw new CLIError("Not authenticated. Run 'bento auth login' first.", "AUTH_REQUIRED");
    }

    this.profile = currentProfile;
    this.sdk = new Analytics({
      siteUuid: currentProfile.siteUuid,
      authentication: {
        publishableKey: currentProfile.publishableKey,
        secretKey: currentProfile.secretKey,
      },
      logErrors: process.env.DEBUG?.includes("bento"),
    });

    return this.sdk;
  }

  /**
   * Validate credentials without storing them
   *
   * Makes a lightweight API call (getSiteStats) to verify the credentials are valid.
   */
  async validateCredentials(
    publishableKey: string,
    secretKey: string,
    siteUuid: string
  ): Promise<boolean> {
    try {
      const tempSdk = new Analytics({
        siteUuid,
        authentication: {
          publishableKey,
          secretKey,
        },
      });

      // Make a lightweight API call to validate credentials
      await tempSdk.V1.Stats.getSiteStats();
      return true;
    } catch (error) {
      // Auth failures → credentials are invalid, return false
      if (error instanceof NotAuthorizedError) {
        return false;
      }

      if (error instanceof RateLimitedError) {
        throw new CLIError(
          "Rate limited while validating credentials. Please wait a moment and try again.",
          "RATE_LIMITED",
          429
        );
      }

      if (error instanceof RequestTimeoutError) {
        throw new CLIError(
          "Request timed out while validating credentials. Please try again.",
          "TIMEOUT",
          408
        );
      }

      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        if (
          msg.includes("401") ||
          msg.includes("unauthorized") ||
          msg.includes("403") ||
          msg.includes("forbidden")
        ) {
          return false;
        }

        // Server errors, timeouts, network failures → rethrow so caller can inform the user
        if (
          msg.includes("500") ||
          msg.includes("timeout") ||
          msg.includes("econnrefused") ||
          msg.includes("enotfound") ||
          msg.includes("fetch failed")
        ) {
          throw new CLIError(
            "Could not reach the Bento API to validate credentials. The service may be temporarily unavailable — please try again.",
            "API_ERROR"
          );
        }
      }

      // Unknown errors — assume bad credentials
      return false;
    }
  }

  /**
   * Reset client (used when switching profiles)
   */
  reset(): void {
    this.sdk = null;
    this.profile = null;
  }

  /**
   * Get current profile info (if authenticated)
   */
  getProfile(): BentoProfile | null {
    return this.profile;
  }

  // ============================================================
  // Subscriber Operations
  // ============================================================

  /**
   * Get a subscriber by email or UUID
   */
  async getSubscriber(
    params: GetSubscriberParams
  ): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();

    if (!params.email && !params.uuid) {
      throw new CLIError(
        "Either email or uuid must be provided to search for a subscriber",
        "VALIDATION_ERROR"
      );
    }

    if (params.email) {
      return this.handleApiCall(() => sdk.V1.Subscribers.getSubscribers({ email: params.email }));
    }

    return this.handleApiCall(() =>
      sdk.V1.Subscribers.getSubscribers({ uuid: params.uuid as string })
    );
  }

  async searchSubscribers(params: SubscriberSearchParams): Promise<SubscriberSearchResult> {
    if (!params.email && !params.uuid) {
      throw new CLIError("Provide --email or --uuid to look up a subscriber.", "VALIDATION_ERROR");
    }

    const subscriber = await this.getSubscriber({
      email: params.email,
      uuid: params.uuid,
    });

    return { subscriber };
  }

  /**
   * Create a subscriber
   */
  async createSubscriber(email: string): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Subscribers.createSubscriber({ email }));
  }

  /**
   * Import subscribers in bulk (up to 1000)
   *
   * Note: This does NOT trigger automations. Use addSubscriber for automation triggers.
   */
  async importSubscribers<S = Record<string, unknown>>(
    params: ImportSubscribersParams<S>
  ): Promise<ImportResult> {
    const sdk = await this.getClient();
    const count = await this.handleApiCall(() =>
      sdk.V1.Batch.importSubscribers({
        subscribers: params.subscribers as ({ email: string } & Partial<{
          [key: string]: unknown;
        }>)[],
      })
    );
    return { imported: count };
  }

  /**
   * Add a subscriber (TRIGGERS automations)
   */
  async addSubscriber(email: string, fields?: Record<string, unknown>): Promise<boolean> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.addSubscriber({ email, fields }));
  }

  /**
   * Unsubscribe a subscriber (does NOT trigger automations)
   */
  async unsubscribe(email: string): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Commands.unsubscribe({ email }));
  }

  /**
   * Subscribe (resubscribe) a subscriber (does NOT trigger automations)
   */
  async subscribe(email: string): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Commands.subscribe({ email }));
  }

  /**
   * Change a subscriber's email
   */
  async changeEmail(
    oldEmail: string,
    newEmail: string
  ): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Commands.changeEmail({ oldEmail, newEmail }));
  }

  // ============================================================
  // Tag Operations
  // ============================================================

  /**
   * List all tags
   */
  async getTags(): Promise<Tag[] | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Tags.getTags());
  }

  /**
   * Create a tag
   */
  async createTag(name: string): Promise<Tag[] | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Tags.createTag({ name }));
  }

  /**
   * Delete a tag by name (looks up tag id from list-tags first).
   */
  async deleteTag(name: string): Promise<{ message: string }> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new CLIError("Tag name cannot be empty.", "VALIDATION_ERROR", 422);
    }

    const tags = await this.getTags();
    const match = tags?.find(
      (tag) => tag.attributes.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );

    if (!match?.id) {
      throw new CLIError(
        `Tag "${trimmedName}" not found. Run 'bento tags list' to inspect available tags.`,
        "NOT_FOUND",
        404
      );
    }

    return this.handleApiCall(() =>
      this.apiDelete<{ message: string }>(`/fetch/tags/${encodeURIComponent(match.id)}`, {
        tag: { name: trimmedName },
      })
    );
  }

  async tagSubscriber(params: TagSubscriberParams): Promise<boolean> {
    const sdk = await this.getClient();
    return this.handleApiCall(() =>
      sdk.V1.tagSubscriber({
        email: params.email,
        tagName: params.tagName,
      })
    );
  }

  /**
   * Add tag to subscriber (does NOT trigger automations)
   */
  async addTag(
    email: string,
    tagName: string
  ): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Commands.addTag({ email, tagName }));
  }

  /**
   * Remove tag from subscriber
   */
  async removeTag(
    email: string,
    tagName: string
  ): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Commands.removeTag({ email, tagName }));
  }

  // ============================================================
  // Field Operations
  // ============================================================

  /**
   * List all fields
   */
  async getFields(): Promise<Field[] | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Fields.getFields());
  }

  /**
   * Create a field
   */
  async createField(key: string): Promise<Field[] | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Fields.createField({ key }));
  }

  /**
   * Add a field value to a subscriber (does NOT trigger automations)
   */
  async addField<S = Record<string, unknown>>(
    params: AddFieldParams<S>
  ): Promise<Subscriber<S> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() =>
      sdk.V1.Commands.addField({
        email: params.email,
        field: params.field as { key: string; value: unknown },
      })
    ) as Promise<Subscriber<S> | null>;
  }

  /**
   * Remove a field from a subscriber
   */
  async removeField(
    email: string,
    fieldName: string
  ): Promise<Subscriber<Record<string, unknown>> | null> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Commands.removeField({ email, fieldName }));
  }

  /**
   * Update fields on a subscriber (TRIGGERS automations)
   */
  async updateFields(email: string, fields: Record<string, unknown>): Promise<boolean> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.updateFields({ email, fields }));
  }

  // ============================================================
  // Event Operations
  // ============================================================

  /**
   * Track a custom event (TRIGGERS automations)
   */
  async track(params: TrackEventParams): Promise<boolean> {
    const sdk = await this.getClient();
    return this.handleApiCall(() =>
      sdk.V1.track({
        email: params.email,
        type: params.type as "$custom",
        details: params.details,
        date: params.date,
        fields: {},
      })
    );
  }

  /**
   * Import events in bulk (up to 1000)
   */
  async importEvents(
    events: Array<{
      email: string;
      type: string;
      details?: Record<string, unknown>;
      date?: Date;
    }>
  ): Promise<number> {
    const sdk = await this.getClient();
    return this.handleApiCall(() =>
      sdk.V1.Batch.importEvents({
        events: events.map((e) => ({
          email: e.email,
          type: e.type as "$custom",
          details: e.details,
          date: e.date,
        })),
      })
    );
  }

  // ============================================================
  // Stats Operations
  // ============================================================

  /**
   * Get site statistics
   */
  async getSiteStats(): Promise<SiteStats> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Stats.getSiteStats());
  }

  // ============================================================
  // Broadcast Operations
  // ============================================================

  /**
   * Fetch a single page of broadcasts
   */
  async getBroadcastsPage(
    page = 1,
    perPage = 25
  ): Promise<{ broadcasts: Broadcast[]; total?: number; hasMore: boolean }> {
    type BroadcastListResponse = {
      data?: Broadcast[];
      meta?: { total?: number; count?: number; page?: number; per_page?: number };
    };

    const response = await this.apiGet<BroadcastListResponse | Broadcast[]>("/fetch/broadcasts", {
      page,
      per_page: perPage,
    });

    const data = Array.isArray(response) ? response : (response.data ?? []);
    const meta = Array.isArray(response) ? undefined : response.meta;
    const total = meta?.total;
    const hasMore = total !== undefined ? page * perPage < total : data.length >= perPage;

    return { broadcasts: data, total, hasMore };
  }

  /**
   * List all broadcasts (auto-paginates)
   */
  async getBroadcasts(): Promise<Broadcast[]> {
    const perPage = 100;
    const maxPages = 200;
    const broadcasts: Broadcast[] = [];
    const seenIds = new Set<string>();

    type BroadcastListResponse = {
      data?: Broadcast[];
      meta?: { total?: number; count?: number; page?: number; per_page?: number };
    };

    let page = 1;
    let total: number | undefined;

    while (page <= maxPages) {
      const response = await this.apiGet<BroadcastListResponse | Broadcast[]>("/fetch/broadcasts", {
        page,
        per_page: perPage,
      });

      const data = Array.isArray(response) ? response : (response.data ?? []);
      const meta = Array.isArray(response) ? undefined : response.meta;

      if (meta?.total !== undefined) {
        total = meta.total;
      }

      if (data.length === 0) {
        break;
      }

      let added = 0;
      for (const item of data) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        broadcasts.push(item);
        added += 1;
      }

      if (total !== undefined && broadcasts.length >= total) {
        break;
      }

      if (added === 0) {
        break;
      }

      page += 1;
    }

    return broadcasts;
  }

  /**
   * Create a new broadcast (draft)
   */
  async createBroadcast(input: BroadcastCreate): Promise<BroadcastCreateResult> {
    const raw = await this.handleApiCall(() =>
      this.apiPost<unknown>("/batch/broadcasts", {
        broadcasts: [input],
      })
    );

    return normalizeBroadcastCreateResult(raw);
  }

  async getBroadcast(id: string): Promise<BroadcastDetail> {
    return this.fetchData(() =>
      this.apiGet<{ data?: BroadcastDetail }>(`/fetch/broadcasts/${encodeURIComponent(id)}`)
    );
  }

  /** Only draft and scheduled broadcasts are editable (409 otherwise). */
  async updateBroadcast(id: string, changes: BroadcastUpdate): Promise<BroadcastDetail> {
    return this.fetchData(() =>
      this.apiPatch<{ data?: BroadcastDetail }>(`/fetch/broadcasts/${encodeURIComponent(id)}`, {
        broadcast: changes,
      })
    );
  }

  // ============================================================
  // Subscriber Activity
  // ============================================================

  async getSubscriberActivity(
    lookup: SubscriberLookup,
    limit?: number
  ): Promise<SubscriberActivity> {
    return this.fetchData(() =>
      this.apiGet<{ data?: SubscriberActivity }>("/fetch/subscribers/activity", {
        email: lookup.email,
        uuid: lookup.uuid,
        limit,
      })
    );
  }

  // ============================================================
  // Email Render / Test
  // ============================================================

  /** Renders and validates Liquid. Never sends. A 200 can still carry `valid: false`. */
  async renderEmail(source: EmailSource, asEmail?: string): Promise<EmailRender> {
    return this.fetchData(() =>
      this.apiPost<{ data?: EmailRender }>("/fetch/emails/render", {
        ...emailSourceBody(source),
        ...(asEmail ? { email: asEmail } : {}),
      })
    );
  }

  async sendTestEmail(source: EmailSource, to: string[], asEmail?: string): Promise<EmailTest> {
    return this.fetchData(() =>
      this.apiPost<{ data?: EmailTest }>("/fetch/emails/test", {
        ...emailSourceBody(source),
        ...(asEmail ? { email: asEmail } : {}),
        to,
      })
    );
  }

  // ============================================================
  // Authors, Segments, Images
  // ============================================================

  async getAuthors(page?: number): Promise<Author[]> {
    return this.fetchList(() =>
      this.apiGet<{ data?: Author[] } | Author[]>("/fetch/authors", { page })
    );
  }

  async getSegments(page?: number): Promise<Segment[]> {
    const segments = await this.fetchList(() =>
      this.apiGet<{ data?: Segment[] } | Segment[]>("/fetch/segments", { page })
    );
    return segments.map(normalizeSegment);
  }

  async getSegment(id: string): Promise<Segment> {
    const segment = await this.fetchData(() =>
      this.apiGet<{ data?: Segment }>(`/fetch/segments/${encodeURIComponent(id)}`)
    );
    return normalizeSegment(segment);
  }

  /** The API cannot create segments yet; they are created in the Bento app. */
  async updateSegment(id: string, input: SegmentInput): Promise<Segment> {
    const segment = await this.fetchData(() =>
      this.apiPatch<{ data?: Segment }>(`/fetch/segments/${encodeURIComponent(id)}`, {
        segment: input,
      })
    );
    return normalizeSegment(segment);
  }

  async uploadImage(input: ImageUploadInput): Promise<ImageUpload> {
    return this.fetchData(() =>
      this.apiPost<{ data?: ImageUpload }>("/fetch/uploads/images", {
        filename: input.filename,
        data: input.data,
      })
    );
  }

  // ============================================================
  // Workflows and Proposals
  // ============================================================

  async getWorkflows(page?: number): Promise<WorkflowSummary[]> {
    return this.fetchList(() =>
      this.apiGet<{ data?: WorkflowSummary[] } | WorkflowSummary[]>("/fetch/workflows", { page })
    );
  }

  async getWorkflow(id: string): Promise<WorkflowDetail> {
    return this.fetchData(() =>
      this.apiGet<{ data?: WorkflowDetail }>(`/fetch/workflows/${encodeURIComponent(id)}`)
    );
  }

  /** Creates a pending proposal. It only takes effect once accepted in the Flow Builder. */
  async proposeWorkflowChange(
    workflowId: string,
    proposal: WorkflowProposalInput
  ): Promise<WorkflowProposal> {
    const created = await this.fetchData(() =>
      this.apiPost<{ data?: WorkflowProposal }>(
        `/fetch/workflows/${encodeURIComponent(workflowId)}/proposals`,
        { proposal }
      )
    );
    return this.withAbsoluteReviewUrl(created);
  }

  async getWorkflowProposals(workflowId: string): Promise<WorkflowProposal[]> {
    const proposals = await this.fetchList(() =>
      this.apiGet<{ data?: WorkflowProposal[] } | WorkflowProposal[]>(
        `/fetch/workflows/${encodeURIComponent(workflowId)}/proposals`
      )
    );
    return proposals.map((proposal) => this.withAbsoluteReviewUrl(proposal));
  }

  /** The API may return `/account/workflows/...`; resolve it against the app host. */
  private withAbsoluteReviewUrl(proposal: WorkflowProposal): WorkflowProposal {
    const reviewUrl = proposal.attributes.review_url;
    if (!reviewUrl || /^https?:\/\//.test(reviewUrl)) return proposal;
    const absolute = new URL(reviewUrl, new URL(this.apiBaseUrl).origin).toString();
    return { ...proposal, attributes: { ...proposal.attributes, review_url: absolute } };
  }

  // ============================================================
  // Sequence Operations
  // ============================================================

  /**
   * List all sequences.
   */
  async getSequences(): Promise<Sequence[]> {
    const sdk = await this.getClient();
    return this.handleApiCall(() => sdk.V1.Sequences.getSequences());
  }

  /**
   * Resolve a sequence ID from an explicit ID or exact name match.
   */
  async resolveSequenceIdForEmail(input: {
    sequenceId?: string;
    sequenceName?: string;
  }): Promise<string> {
    const normalizedSequenceId = input.sequenceId?.trim();
    const normalizedSequenceName = input.sequenceName?.trim();

    if (!normalizedSequenceId && !normalizedSequenceName) {
      throw new CLIError(
        "Provide either --sequence-id or --sequence-name.",
        "VALIDATION_ERROR",
        422
      );
    }

    if (normalizedSequenceId && normalizedSequenceName) {
      throw new CLIError(
        "Provide only one of --sequence-id or --sequence-name.",
        "VALIDATION_ERROR",
        422
      );
    }

    const result: ResolveSequenceIdResult = await resolveSequenceId({
      sequenceId: normalizedSequenceId,
      sequenceName: normalizedSequenceName,
      getSequences: async () => this.getSequences(),
    });

    return this.toResolvedSequenceId(result, normalizedSequenceName);
  }

  /**
   * Create an email template in a sequence.
   */
  async createSequenceEmail(
    sequenceId: string,
    input: CreateSequenceEmailInput
  ): Promise<EmailTemplate | null> {
    if (!isSequenceId(sequenceId)) {
      throw new CLIError(
        "Sequence ID must be the non-empty id returned by 'bento sequences list'.",
        "VALIDATION_ERROR",
        422
      );
    }

    const sdk = await this.getClient();
    const payload = {
      subject: input.subject,
      html: input.html,
      inbox_snippet: input.inboxSnippet,
      delay_interval: input.delayInterval,
      delay_interval_count: input.delayCount,
      editor_choice: input.editorChoice,
      cc: input.cc,
      bcc: input.bcc,
      to: input.to,
    };

    const sequencesApi = sdk.V1.Sequences as {
      createSequenceEmail?: (
        id: string,
        parameters: Record<string, unknown>
      ) => Promise<EmailTemplate | null>;
    };

    const createSequenceEmail = sequencesApi.createSequenceEmail;
    if (typeof createSequenceEmail === "function") {
      return this.handleApiCall(() => createSequenceEmail(sequenceId, payload));
    }

    // Backward-compatible fallback for SDK versions that don't expose createSequenceEmail yet.
    return this.handleApiCall(async () => {
      const response = await this.apiPost<{ data?: EmailTemplate } | EmailTemplate>(
        `/fetch/sequences/${sequenceId}/emails/templates`,
        { email_template: payload }
      );
      if (response && typeof response === "object" && "data" in response) {
        const wrapped = response as { data?: EmailTemplate };
        return wrapped.data ?? null;
      }
      return response as EmailTemplate;
    });
  }

  /**
   * Update an existing email template by template ID.
   */
  async updateSequenceEmail(
    templateId: string,
    input: UpdateSequenceEmailInput
  ): Promise<EmailTemplate | null> {
    if (!/^\d+$/.test(templateId)) {
      throw new CLIError("Template ID must be a positive integer.", "VALIDATION_ERROR", 422);
    }
    const numericTemplateId = Number.parseInt(templateId, 10);
    if (!Number.isFinite(numericTemplateId) || numericTemplateId <= 0) {
      throw new CLIError("Template ID must be a positive integer.", "VALIDATION_ERROR", 422);
    }

    const sdk = await this.getClient();
    // The SDK forwards every non-id field as `email_template`, so `inbox_snippet` reaches the API
    // even though the SDK's parameter type predates it.
    const payload: { id: number; subject?: string; html?: string; inbox_snippet?: string } = {
      id: numericTemplateId,
    };
    if (input.subject !== undefined) payload.subject = input.subject;
    if (input.html !== undefined) payload.html = input.html;
    if (input.inboxSnippet !== undefined) payload.inbox_snippet = input.inboxSnippet;

    return this.handleApiCall(() => sdk.V1.EmailTemplates.updateEmailTemplate(payload));
  }

  private toResolvedSequenceId(result: ResolveSequenceIdResult, sequenceName?: string): string {
    if (result.ok) {
      return result.sequenceId;
    }

    if (result.reason === "missing_input") {
      throw new CLIError(
        "Provide either --sequence-id or --sequence-name.",
        "VALIDATION_ERROR",
        422
      );
    }

    if (result.reason === "not_found") {
      const label = sequenceName ?? result.sequenceName ?? "sequence";
      throw new CLIError(
        `Sequence "${label}" not found. Run 'bento sequences list --json' to inspect available sequences.`,
        "NOT_FOUND",
        404
      );
    }

    const label = sequenceName ?? result.sequenceName ?? "sequence";
    throw new CLIError(
      `Sequence "${label}" was found but the API response did not include an id. Run 'bento sequences list --json' and use --sequence-id with the listed id.`,
      "VALIDATION_ERROR",
      422
    );
  }

  // ============================================================
  // Error Handling
  // ============================================================

  /**
   * Wrap API calls with consistent error handling
   */
  private async fetchData<T>(fn: () => Promise<{ data?: T }>): Promise<T> {
    return this.handleApiCall(async () => unwrapData(await fn()));
  }

  private async fetchList<T>(fn: () => Promise<{ data?: T[] } | T[]>): Promise<T[]> {
    return this.handleApiCall(async () => {
      const response = await fn();
      return Array.isArray(response) ? response : (response?.data ?? []);
    });
  }

  private async handleApiCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.translateError(error);
    }
  }

  /**
   * Translate SDK/API errors to CLI-friendly errors
   */
  private translateError(error: unknown): CLIError {
    if (error instanceof CLIError) {
      return error;
    }

    // Handle SDK-specific error types
    if (error instanceof NotAuthorizedError) {
      return new CLIError(
        "Authentication failed: Invalid API key or insufficient permissions. Run 'bento auth login' to re-authenticate.",
        "AUTH_FAILED",
        401
      );
    }

    if (error instanceof RateLimitedError) {
      return new CLIError(
        "Rate limited: Too many requests. Please wait a moment and try again.",
        "RATE_LIMITED",
        429
      );
    }

    if (error instanceof RequestTimeoutError) {
      return new CLIError(
        "Request timed out. The Bento API may be slow or unreachable. Please try again.",
        "TIMEOUT",
        408
      );
    }

    // Handle generic errors
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // Check for common HTTP status codes in error messages
      if (message.includes("401") || message.includes("unauthorized")) {
        return new CLIError(
          "Authentication failed: Invalid API key or expired credentials. Run 'bento auth login' to re-authenticate.",
          "AUTH_FAILED",
          401
        );
      }

      if (message.includes("403") || message.includes("forbidden")) {
        return new CLIError(
          "Access denied: Your API key does not have permission for this operation.",
          "AUTH_FAILED",
          403
        );
      }

      if (message.includes("404") || message.includes("not found")) {
        return new CLIError("Resource not found.", "NOT_FOUND", 404);
      }

      if (message.includes("429") || message.includes("rate limit")) {
        return new CLIError(
          "Rate limited: Too many requests. Retry in 30 seconds.",
          "RATE_LIMITED",
          429
        );
      }

      if (message.includes("timeout")) {
        return new CLIError("Request timed out. Please try again.", "TIMEOUT", 408);
      }

      if (
        message.includes("422") ||
        message.includes("validation") ||
        message.includes("invalid")
      ) {
        return new CLIError(`Validation error: ${error.message}`, "VALIDATION_ERROR", 422);
      }

      return new CLIError(error.message, "API_ERROR");
    }

    return new CLIError("An unexpected error occurred", "UNKNOWN");
  }

  private async ensureProfileLoaded(): Promise<BentoProfile> {
    if (!this.profile) {
      await this.getClient();
    }

    if (!this.profile) {
      throw new CLIError("Not authenticated. Run 'bento auth login' first.", "AUTH_REQUIRED");
    }

    return this.profile;
  }

  private async apiGet<T>(
    path: string,
    query: Record<string, string | number | undefined> = {}
  ): Promise<T> {
    const profile = await this.ensureProfileLoaded();
    const url = new URL(`${this.apiBaseUrl}${path}`);
    url.searchParams.set("site_uuid", profile.siteUuid);

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      method: "GET",
      headers: this.buildAuthHeaders(profile),
    });

    if (!response.ok) {
      const body = await response.text();
      throw this.createHttpError(response.status, body || response.statusText);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new CLIError("Invalid JSON response from Bento API.", "API_ERROR", response.status);
    }
  }

  private async apiDelete<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    return this.apiSend<T>("DELETE", path, payload);
  }

  private async apiPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    return this.apiSend<T>("POST", path, payload);
  }

  private async apiPatch<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    return this.apiSend<T>("PATCH", path, payload);
  }

  private async apiSend<T>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    const profile = await this.ensureProfileLoaded();
    const url = new URL(`${this.apiBaseUrl}${path}`);
    const body = {
      ...payload,
      site_uuid: profile.siteUuid,
    };

    const response = await fetch(url, {
      method,
      headers: {
        ...this.buildAuthHeaders(profile),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw this.createHttpError(response.status, bodyText || response.statusText);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new CLIError("Invalid JSON response from Bento API.", "API_ERROR", response.status);
    }
  }

  private buildAuthHeaders(profile: BentoProfile): Record<string, string> {
    const token = Buffer.from(`${profile.publishableKey}:${profile.secretKey}`).toString("base64");

    return {
      Authorization: `Basic ${token}`,
      "User-Agent": `bento-cli/${profile.siteUuid}`,
      Accept: "application/json",
    };
  }

  private createHttpError(status: number, body: string): CLIError {
    const error = this.describeHttpError(status, body);
    return new CLIError(error.message, error.code, error.statusCode, parseErrorBody(body));
  }

  private describeHttpError(status: number, body: string): CLIError {
    const detail = extractApiErrorDetail(body);
    const suffix = detail ? ` ${detail}` : "";
    switch (status) {
      case 401:
        return new CLIError(
          "Authentication failed: Invalid credentials. Run 'bento auth login' to re-authenticate.",
          "AUTH_FAILED",
          status
        );
      case 403:
        return new CLIError(
          detail
            ? `Access denied: ${detail}`
            : "Access denied: Your API key does not have permission for this operation.",
          "AUTH_FAILED",
          status
        );
      case 404:
        return new CLIError(`Resource not found.${suffix}`, "NOT_FOUND", status);
      case 422:
        return new CLIError(`Validation error: ${detail ?? body}`, "VALIDATION_ERROR", status);
      case 429:
        return new CLIError(
          `Rate limited: ${detail ?? "Too many requests. Retry in 30 seconds."}`,
          "RATE_LIMITED",
          status
        );
      default:
        if (status >= 500) {
          return new CLIError(
            "The Bento API returned a server error. This is usually temporary — please try again in a few moments.",
            "API_ERROR",
            status
          );
        }
        return new CLIError(`Request failed (${status}): ${detail ?? body}`, "UNKNOWN", status);
    }
  }

  private static validateApiBaseUrl(baseUrl: string): string {
    try {
      const parsed = new URL(baseUrl);
      const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      const isBentoHost =
        parsed.hostname.endsWith(".bentonow.com") || parsed.hostname === "bentonow.com";
      const hasAllowedProtocol =
        parsed.protocol === "https:" || (isLocalHost && parsed.protocol === "http:");

      if (!hasAllowedProtocol || (!isLocalHost && !isBentoHost)) {
        throw new Error("Invalid BENTO_API_BASE_URL host");
      }

      return parsed.toString().replace(/\/$/, "");
    } catch {
      throw new CLIError(
        "Invalid BENTO_API_BASE_URL. Use https://*.bentonow.com (or http://localhost for local development).",
        "VALIDATION_ERROR",
        422
      );
    }
  }
}

/**
 * Pull `{ error, errors }` out of a Bento error body. Returns null for non-JSON bodies.
 */
export function extractApiErrorDetail(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const { error, errors } = parsed as { error?: unknown; errors?: unknown };
  const parts: string[] = [];
  if (typeof error === "string" && error.trim()) parts.push(error.trim());
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (item && typeof item === "object") {
        const { field, line, message } = item as {
          field?: unknown;
          line?: unknown;
          message?: unknown;
        };
        const location = [field, line].filter((v) => v !== undefined && v !== null).join(":");
        const text = typeof message === "string" ? message : JSON.stringify(item);
        parts.push(location ? `${location} ${text}` : text);
      }
    }
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

function parseErrorBody(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function unwrapData<T>(response: { data?: T } | null | undefined): T {
  if (!response || response.data === undefined || response.data === null) {
    throw new CLIError("Unexpected empty response from Bento API.", "API_ERROR");
  }
  return response.data;
}

function emailSourceBody(source: EmailSource): Record<string, unknown> {
  switch (source.kind) {
    case "template":
      return { template_id: source.templateId };
    case "broadcast":
      return { broadcast_id: source.broadcastId };
    case "raw":
      return {
        subject: source.subject,
        html: source.html,
        ...(source.previewText !== undefined ? { preview_text: source.previewText } : {}),
        ...(source.type ? { type: source.type } : {}),
      };
  }
}

function normalizeBroadcastCreateResult(raw: unknown): BroadcastCreateResult {
  if (!raw || typeof raw !== "object") {
    return { results: 0, broadcasts: [], failed: 0, failures: [] };
  }

  const response = raw as {
    results?: unknown;
    broadcasts?: unknown;
    failed?: unknown;
    failures?: unknown;
    data?: unknown;
  };

  if (
    "results" in response ||
    "broadcasts" in response ||
    "failed" in response ||
    "failures" in response
  ) {
    return {
      results: typeof response.results === "number" ? response.results : 0,
      broadcasts: Array.isArray(response.broadcasts)
        ? (response.broadcasts as BroadcastCreateResult["broadcasts"])
        : [],
      failed: typeof response.failed === "number" ? response.failed : 0,
      failures: Array.isArray(response.failures)
        ? (response.failures as BroadcastCreateResult["failures"])
        : [],
    };
  }

  if (Array.isArray(response.data)) {
    return {
      results: response.data.length,
      broadcasts: response.data as BroadcastCreateResult["broadcasts"],
      failed: 0,
      failures: [],
    };
  }

  if (Array.isArray(raw)) {
    return {
      results: raw.length,
      broadcasts: raw as BroadcastCreateResult["broadcasts"],
      failed: 0,
      failures: [],
    };
  }

  return { results: 0, broadcasts: [], failed: 0, failures: [] };
}

// Singleton instance for normal usage
export const bento = new BentoClient();

// Convenience function for credential validation
export async function validateCredentials(
  publishableKey: string,
  secretKey: string,
  siteUuid: string
): Promise<boolean> {
  return new BentoClient().validateCredentials(publishableKey, secretKey, siteUuid);
}

// Re-export CLIError for commands to use
export { CLIError as SDKError };
