import path from "node:path";
import type { Command } from "commander";

import { output } from "../core/output";
import { CLIError, bento } from "../core/sdk";
import { emitJson, exitWithError, validationError } from "../utils/command";
import { readSafeFile } from "../utils/files";

export const MAX_IMAGE_BYTES = 1024 * 1024;
export const DAILY_UPLOAD_LIMIT_MESSAGE =
  "Image upload limit reached: Bento allows 20 image uploads per site per day. Try again tomorrow.";
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

export function registerImagesCommands(program: Command): void {
  const images = program.command("images").description("Upload images for use in emails");

  images
    .command("upload")
    .description("Upload a local image (max 1MB, 20 per site per day) and print its hosted URL")
    .argument("<file>", "Image file within the current directory (png, jpg, jpeg, gif, webp)")
    .action(async (file: string) => {
      try {
        const extension = path.extname(file).toLowerCase();
        if (!IMAGE_EXTENSIONS.includes(extension)) {
          throw validationError(
            `Unsupported image type. Use one of: ${IMAGE_EXTENSIONS.join(", ")}`
          );
        }
        const contents = await readSafeFile(file, "Image file", MAX_IMAGE_BYTES);

        output.startSpinner("Uploading image...");
        const upload = await bento
          .uploadImage({ filename: path.basename(file), data: contents.toString("base64") })
          .catch((error: unknown) => {
            if (error instanceof CLIError && error.statusCode === 429) {
              throw new CLIError(DAILY_UPLOAD_LIMIT_MESSAGE, "RATE_LIMITED", 429);
            }
            throw error;
          });
        output.stopSpinner("Image uploaded");

        if (output.isJson()) {
          emitJson(upload);
          return;
        }
        // The URL is the result, so it prints even under --quiet.
        console.log(upload.attributes.url);
      } catch (error) {
        exitWithError(error);
      }
    });
}
