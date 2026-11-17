import { output } from "../core/output";
import { CLIError } from "../core/sdk";
import type { CLIResponse } from "../types/output";
import { isValidEmail } from "./csv";

/** Print the error (JSON envelope in --json mode) and exit 1. */
export function exitWithError(error: unknown): never {
  output.failSpinner();
  if (error instanceof Error) {
    output.error(error.message);
  } else {
    output.error("An unexpected error occurred.");
  }
  process.exit(1);
}

export function emitJson<T>(data: T, meta: CLIResponse<T>["meta"] = { count: 1 }): void {
  output.json({ success: true, error: null, data, meta });
}

export function validationError(message: string): CLIError {
  return new CLIError(message, "VALIDATION_ERROR", 422);
}

export function parsePositiveInt(
  value: string | undefined,
  flag: string,
  max?: number
): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!/^\d+$/.test(trimmed) || parsed <= 0) {
    throw validationError(`${flag} must be a positive integer.`);
  }
  if (max !== undefined && parsed > max) {
    throw validationError(`${flag} must be between 1 and ${max}.`);
  }
  return parsed;
}

/** `"a, b,,c"` → `["a", "b", "c"]`; an empty string yields `[]` (clears the list server-side). */
export function parseCsvList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseEmailList(value: string, flag: string, max: number): string[] {
  const emails = parseCsvList(value);
  if (emails.length === 0) {
    throw validationError(`${flag} needs at least one email address.`);
  }
  if (emails.length > max) {
    throw validationError(`${flag} accepts at most ${max} email addresses.`);
  }
  const invalid = emails.filter((email) => !isValidEmail(email));
  if (invalid.length > 0) {
    throw validationError(`${flag} has invalid email address(es): ${invalid.join(", ")}`);
  }
  return emails;
}

export function parseIsoTimestamp(value: string, flag: string): string {
  const parsed = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(parsed.getTime())) {
    throw validationError(`${flag} must be an ISO 8601 timestamp, e.g. 2026-11-20T09:00:00Z.`);
  }
  return parsed.toISOString();
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
