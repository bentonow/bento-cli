import type { Segment, SegmentQuery } from "../types/agentic";

/**
 * Bento stores `visitor_event_query` as a JSON string and returns it that way from GET.
 * Parse it so `--json` output and the table both expose the query as an object.
 * Unparseable strings are left as-is rather than dropped.
 */
export function normalizeSegment(segment: Segment): Segment {
  const query = segment.attributes.visitor_event_query as unknown;
  if (typeof query !== "string") return segment;
  try {
    const parsed: unknown = JSON.parse(query);
    if (!isQuery(parsed)) return segment;
    return { ...segment, attributes: { ...segment.attributes, visitor_event_query: parsed } };
  } catch {
    return segment;
  }
}

function isQuery(value: unknown): value is SegmentQuery {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as SegmentQuery).rules)
  );
}
