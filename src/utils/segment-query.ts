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

/**
 * Find the QueryBuilder group in whatever a user saved: the bare query, a JSON string of it,
 * the segment's attributes, the resource, the raw API response, or `segments get --json` output.
 * Returns null when no group with a `rules` array is found.
 */
export function extractSegmentQuery(value: unknown, depth = 0): SegmentQuery | null {
  if (depth > 5) return null;
  if (typeof value === "string") {
    try {
      return extractSegmentQuery(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (isQuery(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  for (const key of ["visitor_event_query", "attributes", "data"]) {
    if (key in record) {
      const found = extractSegmentQuery(record[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function isQuery(value: unknown): value is SegmentQuery {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as SegmentQuery).rules)
  );
}
