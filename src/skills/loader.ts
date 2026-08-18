import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { SkillManifest } from "./types";
import { validateSkillDirectory, validateSkillDirectorySync } from "./validator";

/**
 * Loads a full SkillManifest from a skill directory asynchronously.
 * Validates folder layout (SKILL.md, scripts, references, assets) and parses frontmatter/markdown.
 * Throws an Error with descriptive diagnostic details if validation fails.
 */
export async function loadSkillManifest(
	skillDir: string,
	scope: "project" | "global" = "project",
): Promise<SkillManifest> {
	const result = await validateSkillDirectory(skillDir, scope);
	if (!result.valid || !result.manifest) {
		const details = result.errors.map((e) => `[${e.code}] ${e.message}`).join("; ");
		throw new Error(`Failed to load skill manifest from "${skillDir}": ${details}`);
	}
	return result.manifest;
}

/**
 * Loads a full SkillManifest from a skill directory synchronously.
 */
export function loadSkillManifestSync(
	skillDir: string,
	scope: "project" | "global" = "project",
): SkillManifest {
	const result = validateSkillDirectorySync(skillDir, scope);
	if (!result.valid || !result.manifest) {
		const details = result.errors.map((e) => `[${e.code}] ${e.message}`).join("; ");
		throw new Error(`Failed to load skill manifest from "${skillDir}": ${details}`);
	}
	return result.manifest;
}

/**
 * Resolves a relative asset/script/reference subpath against a skill directory root,
 * enforcing strict sandbox boundary containment to prevent path traversal attacks.
 * Throws an Error if the resolved path escapes the skill directory.
 */
export function resolveSkillAsset(skillDir: string, subPath: string): string {
	const resolvedSkillDir = path.resolve(skillDir);

	// Check if subPath is absolute or starts with root slashes / drive letters
	if (path.isAbsolute(subPath) || subPath.startsWith("/") || subPath.startsWith("\\")) {
		const resolvedTarget = path.resolve(subPath);
		const relative = path.relative(resolvedSkillDir, resolvedTarget);
		if (
			relative === ".." ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative)
		) {
			throw new Error(
				`Path traversal / sandbox violation: subpath "${subPath}" is outside skill directory "${skillDir}"`,
			);
		}
		return resolvedTarget;
	}

	const resolvedTarget = path.resolve(resolvedSkillDir, subPath);
	const relative = path.relative(resolvedSkillDir, resolvedTarget);
		if (
			relative === ".." ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative)
		) {
			throw new Error(
				`Path traversal / sandbox violation: subpath "${subPath}" resolves outside skill directory "${skillDir}"`,
			);
		}

	return resolvedTarget;
}

/**
 * Reads the text content of a skill asset asynchronously with sandbox boundary validation.
 */
export async function readSkillAsset(
	skillDir: string,
	subPath: string,
	encoding: BufferEncoding = "utf-8",
): Promise<string> {
	const safePath = resolveSkillAsset(skillDir, subPath);
	return fsPromises.readFile(safePath, encoding);
}

/**
 * Reads the text content of a skill asset synchronously with sandbox boundary validation.
 */
export function readSkillAssetSync(
	skillDir: string,
	subPath: string,
	encoding: BufferEncoding = "utf-8",
): string {
	const safePath = resolveSkillAsset(skillDir, subPath);
	return fs.readFileSync(safePath, encoding);
}
