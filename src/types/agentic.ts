/**
 * Types for the agentic Bento API endpoints (`/fetch/*`).
 *
 * Every single-resource response is JSON:API style (`{ data: { id, type, attributes } }`).
 * The client unwraps `data`, so these types describe the resource itself.
 */

export interface Resource<A, T extends string = string> {
  id: string;
  type: T;
  attributes: A;
}

// ------------------------------------------------------------
// Subscriber activity
// ------------------------------------------------------------

export interface SubscriberActivityEvent {
  uuid: string;
  type: string;
  happened_at: string | null;
  data: Record<string, unknown> | null;
}

export interface SubscriberActivitySummary {
  event_count: number | null;
  last_event_at: string | null;
  last_email_opened_at: string | null;
  last_email_clicked_at: string | null;
  last_visit_at: string | null;
  last_engagement: { type: string; at: string | null } | null;
}

export type SubscriberActivity = Resource<
  {
    email: string;
    uuid: string;
    summary: SubscriberActivitySummary;
    recent_events: SubscriberActivityEvent[];
  },
  "subscriber_activity"
>;

export type SubscriberLookup = { email: string; uuid?: never } | { uuid: string; email?: never };

// ------------------------------------------------------------
// Email render / test
// ------------------------------------------------------------

/** Exactly one email source; the API rejects mixed sources. */
export type EmailSource =
  | { kind: "template"; templateId: number }
  | { kind: "broadcast"; broadcastId: number }
  | { kind: "raw"; subject: string; html: string; previewText?: string };

export interface LiquidIssue {
  field: string;
  line?: number | null;
  message: string;
}

export interface RenderedEmail {
  subject: string | null;
  preview_text: string | null;
  html: string | null;
  text: string | null;
  from: string | null;
  to: string | null;
}

export type EmailRender = Resource<
  {
    valid: boolean;
    errors: LiquidIssue[];
    warnings: LiquidIssue[];
    rendered: RenderedEmail | null;
    rendered_as: string | null;
  },
  "email_render"
>;

export interface EmailTestDelivery {
  to: string;
  status: string;
  job_id?: string | null;
  queued_at?: string | null;
}

export type EmailTest = Resource<
  {
    status: string;
    deliveries: EmailTestDelivery[];
    rendered: RenderedEmail | null;
    warnings: LiquidIssue[];
  },
  "email_test"
>;

// ------------------------------------------------------------
// Broadcasts
// ------------------------------------------------------------

export type BroadcastStatus = "draft" | "scheduled" | "paused" | "canceled" | "sending" | "sent";

export type BroadcastDetail = Resource<
  {
    name: string;
    status: BroadcastStatus | string;
    subject: string | null;
    preview_text: string | null;
    html: string | null;
    template_id: number | null;
    author: { id: number; name: string | null; email: string | null } | null;
    audience: {
      segment_ids: number[];
      inclusive_tags: string[];
      exclusive_tags: string[];
      visitor_query: Record<string, unknown> | null;
    } | null;
    send_at: string | null;
    approved_at: string | null;
    batch_size_per_hour: number | null;
    created_at: string | null;
    sent_final_batch_at: string | null;
    share_url: string | null;
    stats: Record<string, unknown> | null;
  },
  "broadcast"
>;

/** Body of `broadcast` in `PATCH /fetch/broadcasts/:id`. Every field is optional. */
export interface BroadcastUpdate {
  name?: string;
  subject?: string;
  content?: string;
  type?: "plain" | "raw";
  preview_text?: string;
  author_id?: number;
  segment_id?: number | null;
  inclusive_tags?: string[];
  exclusive_tags?: string[];
  send_at?: string;
  batch_size_per_hour?: number;
  approved?: boolean;
}

/** Body of one entry in `POST /batch/broadcasts`. */
export interface BroadcastCreate {
  name: string;
  subject: string;
  content: string;
  type: "plain" | "html" | "markdown";
  from?: { name: string; email: string };
  author_id?: number;
  preview_text?: string;
  segment_id?: number;
  inclusive_tags?: string[];
  exclusive_tags?: string[];
  send_at?: string;
  batch_size_per_hour: number;
}

// ------------------------------------------------------------
// Authors, segments, images
// ------------------------------------------------------------

export type Author = Resource<
  { name: string | null; email: string | null; created_at?: string | null },
  "author"
>;

/** jQuery QueryBuilder JSON, validated server-side. */
export interface SegmentQuery {
  condition?: string;
  rules?: unknown[];
  [key: string]: unknown;
}

export type Segment = Resource<
  {
    name: string;
    description?: string | null;
    visitor_event_query?: SegmentQuery | null;
    created_at?: string | null;
    [key: string]: unknown;
  },
  string
>;

export interface SegmentInput {
  name?: string;
  description?: string;
  visitor_event_query?: SegmentQuery;
}

export interface ImageUploadInput {
  filename: string;
  /** Base64 encoded file contents. */
  data: string;
}

export type ImageUpload = Resource<{ url: string; filename: string; size: number }, "image_upload">;

// ------------------------------------------------------------
// Workflows and proposals
// ------------------------------------------------------------

export type WorkflowSummary = Resource<
  { name: string; status: string; created_at?: string | null; [key: string]: unknown },
  string
>;

export interface WorkflowNode {
  id: string;
  type?: string;
  [key: string]: unknown;
}

export type WorkflowDetail = Resource<
  {
    name: string;
    status: string;
    diagram_revision?: string | null;
    nodes?: WorkflowNode[];
    [key: string]: unknown;
  },
  string
>;

/** Tanuki patch format; field names are owned and validated by the server. */
export type WorkflowPatch = Record<string, unknown>;

export interface WorkflowProposalInput {
  summary: string;
  patch: WorkflowPatch;
  base_revision?: string;
}

export type WorkflowProposal = Resource<
  {
    workflow_id: string;
    summary: string;
    status: "pending" | "accepted" | "rejected" | "stale" | string;
    source: string;
    base_revision: string | null;
    created_at: string | null;
    expires_at: string | null;
    review_url: string | null;
    patch: WorkflowPatch;
  },
  "workflow_proposal"
>;
