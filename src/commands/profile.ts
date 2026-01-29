/**
 * Profile management commands
 *
 * Commands:
 * - bento profile add <name> - Add a new profile
 * - bento profile list - List all profiles
 * - bento profile use <name> - Switch to a profile
 * - bento profile remove <name> - Remove a profile
 */

import { Command } from "commander";
import { password, input, confirm } from "@inquirer/prompts";
import { config, ConfigError } from "../core/config";
import { validateCredentials, bento } from "../core/sdk";
import { output } from "../core/output";

export function registerProfileCommands(program: Command): void {
  const profile = program
    .command("profile")
    .description("Manage credential profiles");

  profile
    .command("add")
    .argument("<name>", "Name for the new profile")
    .description("Add a new profile")
    .option("--api-key <key>", "API key (for non-interactive use)")
    .option("--site-id <id>", "Site ID (for non-interactive use)")
    .action(async (name: string, options: { apiKey?: string; siteId?: string }) => {
      try {
        // Check if profile already exists
        const exists = await config.hasProfile(name);
        if (exists) {
          output.error(
            `Profile "${name}" already exists. Use 'bento auth login --profile ${name}' to update it.`
          );
          process.exit(1);
        }

        let apiKey = options.apiKey;
        let siteId = options.siteId;

        // Interactive mode if credentials not provided via flags
        if (!apiKey || !siteId) {
          if (!process.stdin.isTTY && (!apiKey || !siteId)) {
            output.error(
              "Non-interactive mode requires --api-key and --site-id flags."
            );
            process.exit(1);
          }

          output.info(`Creating profile "${name}"`);
          output.log("Find your credentials at: https://app.bentonow.com/settings/api");
          output.newline();

          if (!apiKey) {
            apiKey = await password({
              message: "Enter your Bento API key:",
              mask: "*",
            });
          }

          if (!siteId) {
            siteId = await input({
              message: "Enter your Bento Site ID:",
            });
          }
        }

        // Validate inputs
        if (!apiKey?.trim()) {
          output.error("API key cannot be empty.");
          process.exit(1);
        }

        if (!siteId?.trim()) {
          output.error("Site ID cannot be empty.");
          process.exit(1);
        }

        apiKey = apiKey.trim();
        siteId = siteId.trim();

        // Validate credentials against API
        output.startSpinner("Validating credentials...");
        const isValid = await validateCredentials(apiKey, siteId);

        if (!isValid) {
          output.failSpinner("Invalid credentials");
          output.error(
            "Invalid credentials. Please check your API key and Site ID."
          );
          process.exit(1);
        }

        output.stopSpinner("Credentials validated");

        // Save to config
        await config.setProfile(name, { apiKey, siteId });

        if (output.isJson()) {
          output.json({
            success: true,
            error: null,
            data: { profile: name, siteId },
            meta: { count: 1 },
          });
        } else {
          output.success(`Profile "${name}" created`);
          output.info(`Switch to it with: bento profile use ${name}`);
        }
      } catch (error) {
        if (error instanceof ConfigError) {
          output.error(`${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });

  profile
    .command("list")
    .description("List all profiles")
    .action(async () => {
      try {
        const cfg = await config.load();
        const profileNames = Object.keys(cfg.profiles);

        if (profileNames.length === 0) {
          if (output.isJson()) {
            output.json({
              success: true,
              error: null,
              data: [],
              meta: { count: 0 },
            });
          } else {
            output.info(
              "No profiles configured. Run 'bento auth login' to create one."
            );
          }
          return;
        }

        const profileData = profileNames.map((name) => {
          const p = cfg.profiles[name];
          return {
            name,
            current: name === cfg.current ? "✓" : "",
            siteId: p.siteId,
            created: formatDateShort(p.createdAt),
          };
        });

        if (output.isJson()) {
          output.json({
            success: true,
            error: null,
            data: profileData.map((p) => ({
              ...p,
              current: p.current === "✓",
            })),
            meta: { count: profileData.length },
          });
        } else {
          output.table(profileData, {
            columns: [
              { key: "current", header: "" },
              { key: "name", header: "NAME" },
              { key: "siteId", header: "SITE ID" },
              { key: "created", header: "CREATED" },
            ],
          });
        }
      } catch (error) {
        if (error instanceof ConfigError) {
          output.error(`${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });

  profile
    .command("use")
    .argument("<name>", "Name of the profile to switch to")
    .description("Switch to a profile")
    .action(async (name: string) => {
      try {
        await config.useProfile(name);

        // Reset the SDK client so it picks up the new credentials
        bento.reset();

        if (output.isJson()) {
          output.json({
            success: true,
            error: null,
            data: { profile: name },
            meta: { count: 1 },
          });
        } else {
          output.success(`Switched to profile "${name}"`);
        }
      } catch (error) {
        if (error instanceof ConfigError) {
          output.error(`${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });

  profile
    .command("remove")
    .argument("<name>", "Name of the profile to remove")
    .description("Remove a profile")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (name: string, options: { yes?: boolean }) => {
      try {
        // Check if profile exists
        const exists = await config.hasProfile(name);
        if (!exists) {
          output.error(`Profile "${name}" not found.`);
          process.exit(1);
        }

        // Confirm deletion unless --yes flag is passed
        if (!options.yes) {
          if (!process.stdin.isTTY) {
            output.error(
              "Non-interactive mode requires --yes flag to confirm deletion."
            );
            process.exit(1);
          }

          const confirmed = await confirm({
            message: `Are you sure you want to remove profile "${name}"?`,
            default: false,
          });

          if (!confirmed) {
            output.info("Aborted.");
            return;
          }
        }

        const currentProfileName = await config.getCurrentProfileName();
        const wasCurrentProfile = currentProfileName === name;

        await config.removeProfile(name);

        // Reset the SDK client if we removed the current profile
        if (wasCurrentProfile) {
          bento.reset();
        }

        if (output.isJson()) {
          output.json({
            success: true,
            error: null,
            data: { profile: name, wasCurrentProfile },
            meta: { count: 1 },
          });
        } else {
          output.success(`Profile "${name}" removed`);
          if (wasCurrentProfile) {
            output.info(
              "This was the active profile. Run 'bento auth login' or 'bento profile use <name>' to authenticate."
            );
          }
        }
      } catch (error) {
        if (error instanceof ConfigError) {
          output.error(`${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });
}

/**
 * Format ISO date string for table display (short format)
 */
function formatDateShort(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}
