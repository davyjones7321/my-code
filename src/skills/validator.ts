import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { parseSkillMarkdown } from "./parser";
import type { SkillManifest, SkillValidationError, SkillValidationResult } from "./types";
import { SkillErrorCodes } from "./types";

export interface DirectoryScanResult {
	valid: boolean;
	errors: SkillValidationError[];
	skillMdPath?: string;
	scripts: string[];
	references: string[];
	assets: string[];
}

/**
 * Normalizes backslashes in paths to POSIX forward slashes.
 */
export function toPosixPath(p: string): string {
	return p.replace(/\\/g, "/");
}

/**
 * Recursively scans files in a subdirectory and returns sorted relative POSIX paths.
 */
async function scanSubdirectoryFiles(subDirPath: string, relativePrefix = ""): Promise<string[]> {
	const files: string[] = [];
	try {
		const entries = await fsPromises.readdir(subDirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === ".git" || entry.name === ".DS_Store" || entry.name === ".gitkeep") {
				continue;
			}
			const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
			const fullPath = path.join(subDirPath, entry.name);
			if (entry.isDirectory()) {
				const nested = await scanSubdirectoryFiles(fullPath, relPath);
				files.push(...nested);
			} else if (entry.isFile()) {
				files.push(toPosixPath(relPath));
			}
		}
	} catch (err: unknown) {
		if ((err as { code?: string })?.code !== "ENOENT") throw err;
	}
	return files.sort();
}

/**
 * Synchronous recursive file scanner for subdirectories.
 */
function scanSubdirectoryFilesSync(subDirPath: string, relativePrefix = ""): string[] {
	const files: string[] = [];
	try {
		const entries = fs.readdirSync(subDirPath, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === ".git" || entry.name === ".DS_Store" || entry.name === ".gitkeep") {
				continue;
			}
			const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
			const fullPath = path.join(subDirPath, entry.name);
			if (entry.isDirectory()) {
				const nested = scanSubdirectoryFilesSync(fullPath, relPath);
				files.push(...nested);
			} else if (entry.isFile()) {
				files.push(toPosixPath(relPath));
			}
		}
	} catch (err: unknown) {
		if ((err as { code?: string })?.code !== "ENOENT") throw err;
	}
	return files.sort();
}

/**
 * Validates the physical directory layout of a skill folder asynchronously.
 */
export async function validateDirectoryStructure(dirPath: string): Promise<DirectoryScanResult> {
	const errors: SkillValidationError[] = [];
	const resolvedDir = path.resolve(dirPath);

	// 1. Verify dirPath existence and directory type
	try {
		const stat = await fsPromises.stat(resolvedDir);
		if (!stat.isDirectory()) {
			return {
				valid: false,
				errors: [
					{
						code: SkillErrorCodes.NOT_A_DIRECTORY,
						message: `Skill path is not a directory: ${dirPath}`,
						path: resolvedDir,
					},
				],
				scripts: [],
				references: [],
				assets: [],
			};
		}
	} catch (_err: unknown) {
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.NOT_FOUND,
					message: `Skill directory not found: ${dirPath}`,
					path: resolvedDir,
				},
			],
			scripts: [],
			references: [],
			assets: [],
		};
	}

	// 2. Read root entries
	let entries: fs.Dirent[] = [];
	try {
		entries = await fsPromises.readdir(resolvedDir, { withFileTypes: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.READ_ERROR,
					message: `Failed to read skill directory: ${message}`,
					path: resolvedDir,
				},
			],
			scripts: [],
			references: [],
			assets: [],
		};
	}

	const entryMap = new Map<string, fs.Dirent>();
	for (const entry of entries) {
		entryMap.set(entry.name, entry);
	}

	// 3. Verify SKILL.md
	const skillMdEntry = entryMap.get("SKILL.md");
	const skillMdPath = path.join(resolvedDir, "SKILL.md");

	if (!skillMdEntry) {
		errors.push({
			code: SkillErrorCodes.MISSING_SKILL_MD,
			message: `Mandatory SKILL.md file not found in skill directory: ${dirPath}`,
			path: skillMdPath,
		});
	} else if (!skillMdEntry.isFile()) {
		errors.push({
			code: SkillErrorCodes.INVALID_SUBDIRECTORY,
			message: `Expected 'SKILL.md' to be a file, but found a directory: ${skillMdPath}`,
			path: skillMdPath,
		});
	}

	// 4. Verify subdirectories: scripts, references, assets
	const checkSubdir = async (subName: "scripts" | "references" | "assets"): Promise<string[]> => {
		const entry = entryMap.get(subName);
		if (!entry) return [];
		const subPath = path.join(resolvedDir, subName);
		if (!entry.isDirectory()) {
			errors.push({
				code: SkillErrorCodes.INVALID_SUBDIRECTORY,
				message: `Expected '${subName}' to be a directory, but found a file: ${subPath}`,
				path: subPath,
			});
			return [];
		}
		return scanSubdirectoryFiles(subPath, subName);
	};

	const [scripts, references, assets] = await Promise.all([
		checkSubdir("scripts"),
		checkSubdir("references"),
		checkSubdir("assets"),
	]);

	return {
		valid: errors.length === 0,
		errors,
		skillMdPath: skillMdEntry?.isFile() ? skillMdPath : undefined,
		scripts,
		references,
		assets,
	};
}

/**
 * Validates a skill directory asynchronously on disk, reading SKILL.md and constructing manifest.
 */
export async function validateSkillDirectory(
	dirPath: string,
	scope: "project" | "global" = "project",
): Promise<SkillValidationResult> {
	const dirResult = await validateDirectoryStructure(dirPath);
	if (!dirResult.valid || !dirResult.skillMdPath) {
		return {
			valid: false,
			errors: dirResult.errors,
		};
	}

	// Read SKILL.md
	let rawContent: string;
	try {
		rawContent = await fsPromises.readFile(dirResult.skillMdPath, "utf-8");
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.READ_ERROR,
					message: `Failed to read SKILL.md: ${message}`,
					path: dirResult.skillMdPath,
				},
			],
		};
	}

	// Parse markdown & frontmatter
	const parseResult = parseSkillMarkdown(rawContent, dirPath, scope);
	if (!parseResult.valid || !parseResult.manifest) {
		return {
			valid: false,
			errors: parseResult.errors,
		};
	}

	// Construct complete manifest with directory assets
	const manifest: SkillManifest = {
		...parseResult.manifest,
		skillDir: path.resolve(dirPath),
		scope: scope || "project",
		hasScripts: dirResult.scripts.length > 0,
		hasReferences: dirResult.references.length > 0,
		hasAssets: dirResult.assets.length > 0,
		scripts: dirResult.scripts,
		references: dirResult.references,
		assets: dirResult.assets,
	};

	return {
		valid: true,
		errors: [],
		manifest,
	};
}

/**
 * Validates a skill directory synchronously.
 */
export function validateSkillDirectorySync(
	dirPath: string,
	scope: "project" | "global" = "project",
): SkillValidationResult {
	const resolvedDir = path.resolve(dirPath);

	// 1. Verify existence
	try {
		const stat = fs.statSync(resolvedDir);
		if (!stat.isDirectory()) {
			return {
				valid: false,
				errors: [
					{
						code: SkillErrorCodes.NOT_A_DIRECTORY,
						message: `Skill path is not a directory: ${dirPath}`,
						path: resolvedDir,
					},
				],
			};
		}
	} catch (_err: unknown) {
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.NOT_FOUND,
					message: `Skill directory not found: ${dirPath}`,
					path: resolvedDir,
				},
			],
		};
	}

	// 2. Read entries
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.READ_ERROR,
					message: `Failed to read skill directory: ${message}`,
					path: resolvedDir,
				},
			],
		};
	}

	const entryMap = new Map<string, fs.Dirent>();
	for (const entry of entries) {
		entryMap.set(entry.name, entry);
	}

	const errors: SkillValidationError[] = [];
	const skillMdEntry = entryMap.get("SKILL.md");
	const skillMdPath = path.join(resolvedDir, "SKILL.md");

	if (!skillMdEntry) {
		errors.push({
			code: SkillErrorCodes.MISSING_SKILL_MD,
			message: `Mandatory SKILL.md file not found in skill directory: ${dirPath}`,
			path: skillMdPath,
		});
	} else if (!skillMdEntry.isFile()) {
		errors.push({
			code: SkillErrorCodes.INVALID_SUBDIRECTORY,
			message: `Expected 'SKILL.md' to be a file, but found a directory: ${skillMdPath}`,
			path: skillMdPath,
		});
	}

	const checkSubdir = (subName: "scripts" | "references" | "assets"): string[] => {
		const entry = entryMap.get(subName);
		if (!entry) return [];
		const subPath = path.join(resolvedDir, subName);
		if (!entry.isDirectory()) {
			errors.push({
				code: SkillErrorCodes.INVALID_SUBDIRECTORY,
				message: `Expected '${subName}' to be a directory, but found a file: ${subPath}`,
				path: subPath,
			});
			return [];
		}
		return scanSubdirectoryFilesSync(subPath, subName);
	};

	const scripts = checkSubdir("scripts");
	const references = checkSubdir("references");
	const assets = checkSubdir("assets");

	if (errors.length > 0 || !skillMdEntry || !skillMdEntry.isFile()) {
		return {
			valid: false,
			errors,
		};
	}

	let rawContent: string;
	try {
		rawContent = fs.readFileSync(skillMdPath, "utf-8");
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.READ_ERROR,
					message: `Failed to read SKILL.md: ${message}`,
					path: skillMdPath,
				},
			],
		};
	}

	const parseResult = parseSkillMarkdown(rawContent, dirPath, scope);
	if (!parseResult.valid || !parseResult.manifest) {
		return {
			valid: false,
			errors: parseResult.errors,
		};
	}

	const manifest: SkillManifest = {
		...parseResult.manifest,
		skillDir: resolvedDir,
		scope: scope || "project",
		hasScripts: scripts.length > 0,
		hasReferences: references.length > 0,
		hasAssets: assets.length > 0,
		scripts,
		references,
		assets,
	};

	return {
		valid: true,
		errors: [],
		manifest,
	};
}
