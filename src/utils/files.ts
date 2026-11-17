import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { CLIError } from "../core/sdk";

/**
 * Resolve a user-supplied path, refusing anything outside the current working directory.
 * Agents drive this CLI, so a stray `--html-file ~/.ssh/id_rsa` must not be readable or uploadable.
 */
export function resolveSafePath(inputPath: string, label: string): string {
  const resolvedPath = path.resolve(inputPath);
  const relativePath = path.relative(process.cwd(), resolvedPath);
  const isOutsideProject = relativePath.startsWith("..") || path.isAbsolute(relativePath);

  if (isOutsideProject) {
    throw new CLIError(
      `${label} path must be within the current working directory.`,
      "VALIDATION_ERROR",
      422
    );
  }

  return resolvedPath;
}

export async function readSafeTextFile(
  inputPath: string,
  label: string,
  maxBytes: number
): Promise<string> {
  const buffer = await readSafeFile(inputPath, label, maxBytes);
  return buffer.toString("utf8");
}

export async function readSafeFile(
  inputPath: string,
  label: string,
  maxBytes: number
): Promise<Buffer> {
  const safePath = resolveSafePath(inputPath, label);
  try {
    const info = await stat(safePath);
    if (info.size > maxBytes) {
      throw new CLIError(`${label} must be under ${maxBytes} bytes.`, "VALIDATION_ERROR", 422);
    }
    return await readFile(safePath);
  } catch (error) {
    throw toFileError(error, label, inputPath);
  }
}

export async function readSafeJsonFile(inputPath: string, label: string): Promise<unknown> {
  const text = await readSafeTextFile(inputPath, label, 1_048_576);
  try {
    return JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CLIError(`${label} is not valid JSON: ${reason}`, "VALIDATION_ERROR", 422);
  }
}

export async function writeSafeTextFile(
  inputPath: string,
  label: string,
  content: string
): Promise<string> {
  const safePath = resolveSafePath(inputPath, label);
  try {
    await writeFile(safePath, content, "utf8");
    return safePath;
  } catch (error) {
    throw toFileError(error, label, inputPath);
  }
}

function toFileError(error: unknown, label: string, inputPath: string): CLIError {
  if (error instanceof CLIError) return error;
  if (error instanceof Error && "code" in error) {
    const code = String(error.code);
    if (code === "ENOENT") {
      return new CLIError(`${label} not found: ${inputPath}`, "VALIDATION_ERROR", 422);
    }
    if (code === "EACCES") {
      return new CLIError(
        `Cannot access ${label} (permission denied): ${inputPath}`,
        "VALIDATION_ERROR",
        422
      );
    }
  }
  return new CLIError(`Unable to access ${label}: ${inputPath}`, "VALIDATION_ERROR", 422);
}
