import type { Command } from "commander";

import { output } from "../../core/output";
import { bento } from "../../core/sdk";
import type { SubscriberLookup } from "../../types/agentic";
import {
  emitJson,
  exitWithError,
  formatTimestamp,
  parsePositiveInt,
  truncate,
  validationError,
} from "../../utils/command";

interface ActivityOptions {
  uuid?: string;
  limit?: string;
}

const MAX_ACTIVITY_LIMIT = 100;

export function registerActivityCommand(subscribers: Command): void {
  subscribers
    .command("activity")
    .description("Show a subscriber's engagement summary and recent events")
    .argument("[email]", "Subscriber email")
    .option("--uuid <uuid>", "Look up by subscriber UUID instead of email")
    .option("--limit <n>", `Number of recent events (1-${MAX_ACTIVITY_LIMIT}, default 25)`)
    .action(async (email: string | undefined, options: ActivityOptions) => {
      try {
        const lookup = toLookup(email, options.uuid);
        const limit = parsePositiveInt(options.limit, "--limit", MAX_ACTIVITY_LIMIT);

        output.startSpinner("Fetching subscriber activity...");
        const activity = await bento.getSubscriberActivity(lookup, limit);
        output.stopSpinner();

        const { summary, recent_events: events } = activity.attributes;
        if (output.isJson()) {
          emitJson(activity, { count: events.length });
          return;
        }

        output.log(`Subscriber: ${activity.attributes.email} (${activity.attributes.uuid})`);
        output.log(`Events:            ${summary.event_count ?? "—"}`);
        output.log(`Last event:        ${formatTimestamp(summary.last_event_at)}`);
        output.log(`Last email opened: ${formatTimestamp(summary.last_email_opened_at)}`);
        output.log(`Last email click:  ${formatTimestamp(summary.last_email_clicked_at)}`);
        output.log(`Last visit:        ${formatTimestamp(summary.last_visit_at)}`);
        const engagement = summary.last_engagement;
        output.log(
          `Last engagement:   ${engagement ? `${engagement.type} at ${formatTimestamp(engagement.at)}` : "—"}`
        );
        output.newline();

        output.table(
          events.map((event) => ({
            happened: formatTimestamp(event.happened_at),
            type: event.type,
            details: event.data ? truncate(JSON.stringify(event.data), 80) : "",
          })),
          {
            columns: [
              { key: "happened", header: "HAPPENED" },
              { key: "type", header: "TYPE" },
              { key: "details", header: "DETAILS" },
            ],
            emptyMessage: "No recent events.",
          }
        );
      } catch (error) {
        exitWithError(error);
      }
    });
}

function toLookup(email: string | undefined, uuid: string | undefined): SubscriberLookup {
  const trimmedEmail = email?.trim();
  const trimmedUuid = uuid?.trim();
  if (trimmedEmail && trimmedUuid) {
    throw validationError("Provide either an email or --uuid, not both.");
  }
  if (trimmedEmail) return { email: trimmedEmail };
  if (trimmedUuid) return { uuid: trimmedUuid };
  throw validationError("Provide a subscriber email or --uuid.");
}
