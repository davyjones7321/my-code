import YAML from "yaml";
import type {
	SkillFrontmatter,
	SkillManifest,
	SkillValidationError,
	SkillValidationResult,
} from "./types";
import { SkillErrorCodes } from "./types";
import { validateSkillDirectory, validateSkillDirectorySync } from "./validator";

export { validateSkillDirectory, validateSkillDirectorySync };

/**
 * Normalizes content by stripping UTF-8 BOM and standardizing CRLF/CR to LF.
 */
export function normalizeSkillContent(content: string): string {
	let clean = content;
	if (clean.charCodeAt(0) === 0xfeff || clean.startsWith("\uFEFF")) {
		clean = clean.slice(1);
	}
	return clean.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Parses SKILL.md markdown content, extracting YAML frontmatter and body instructions.
 * Validates mandatory metadata fields (name, description) and standard data types.
 */
export function parseSkillMarkdown(
	content: string,
	skillDir = "",
	scope: "project" | "global" = "project",
): SkillValidationResult {
	const normalized = normalizeSkillContent(content);
	const lines = normalized.split("\n");

	if (lines.length === 0 || lines[0].trim() !== "---") {
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.INVALID_DELIMITER,
					message: "SKILL.md must start with '---' frontmatter delimiter",
				},
			],
		};
	}

	let closingIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === "---") {
			closingIndex = i;
			break;
		}
	}

	if (closingIndex === -1) {
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.INVALID_DELIMITER,
					message: "SKILL.md frontmatter is missing closing '---' delimiter",
				},
			],
		};
	}

	const frontmatterYaml = lines.slice(1, closingIndex).join("\n");
	const markdownBody = lines
		.slice(closingIndex + 1)
		.join("\n")
		.replace(/^\n+/, "");

	let parsedYaml: unknown;
	try {
		parsedYaml = YAML.parse(frontmatterYaml);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.INVALID_YAML,
					message: `YAML frontmatter parsing failed: ${message}`,
				},
			],
		};
	}

	if (parsedYaml !== null && (typeof parsedYaml !== "object" || Array.isArray(parsedYaml))) {
		return {
			valid: false,
			errors: [
				{
					code: SkillErrorCodes.INVALID_YAML,
					message: "Frontmatter must be a key-value mapping/object",
				},
			],
		};
	}

	const data = (parsedYaml && typeof parsedYaml === "object" ? parsedYaml : {}) as Record<
		string,
		unknown
	>;
	const errors: SkillValidationError[] = [];

	// 1. Validate 'name' (required, non-empty string)
	if (data.name === undefined || data.name === null) {
		errors.push({
			code: SkillErrorCodes.MISSING_NAME,
			message: "Frontmatter missing required field: 'name'",
			field: "name",
		});
	} else if (typeof data.name !== "string") {
		errors.push({
			code: SkillErrorCodes.INVALID_NAME,
			message: "Field 'name' must be a string",
			field: "name",
		});
	} else if (data.name.trim().length === 0) {
		errors.push({
			code: SkillErrorCodes.INVALID_NAME,
			message: "Skill name cannot be empty or whitespace only",
			field: "name",
		});
	} else if (/[A-Z\s!@#$%^&*()+=\[\]{}|\\/:;'"<>,.?~`]/.test(data.name as string)) {
		errors.push({
			code: SkillErrorCodes.INVALID_NAME,
			message: "Skill name must contain only lowercase letters, numbers, hyphens, and emojis",
			field: "name",
		});
	}

	// 2. Validate 'description' (required, non-empty string)
	if (data.description === undefined || data.description === null) {
		errors.push({
			code: SkillErrorCodes.MISSING_DESCRIPTION,
			message: "Frontmatter missing required field: 'description'",
			field: "description",
		});
	} else if (typeof data.description !== "string") {
		errors.push({
			code: SkillErrorCodes.INVALID_DESCRIPTION,
			message: "Field 'description' must be a string",
			field: "description",
		});
	} else if (data.description.trim().length === 0) {
		errors.push({
			code: SkillErrorCodes.EMPTY_DESCRIPTION,
			message: "Skill description cannot be empty or whitespace only",
			field: "description",
		});
	}

	// 3. Validate 'version' (optional, string or number)
	if (data.version !== undefined && data.version !== null) {
		if (typeof data.version !== "string" && typeof data.version !== "number") {
			errors.push({
				code: SkillErrorCodes.INVALID_VERSION,
				message: "Field 'version' must be a string",
				field: "version",
			});
		}
	}

	// 4. Validate 'tags' (optional, array of strings)
	if (data.tags !== undefined && data.tags !== null) {
		if (!Array.isArray(data.tags) || data.tags.some((t: unknown) => typeof t !== "string")) {
			errors.push({
				code: SkillErrorCodes.INVALID_TAGS,
				message: "Field 'tags' must be an array of strings",
				field: "tags",
			});
		}
	}

	// 5. Validate 'triggers' (optional, array of strings)
	if (data.triggers !== undefined && data.triggers !== null) {
		if (
			!Array.isArray(data.triggers) ||
			data.triggers.some((t: unknown) => typeof t !== "string")
		) {
			errors.push({
				code: SkillErrorCodes.INVALID_TRIGGERS,
				message: "Field 'triggers' must be an array of strings",
				field: "triggers",
			});
		}
	}

	// 6. Validate 'author' & 'license' (optional strings)
	if (data.author !== undefined && data.author !== null && typeof data.author !== "string") {
		errors.push({
			code: SkillErrorCodes.INVALID_AUTHOR,
			message: "Field 'author' must be a string",
			field: "author",
		});
	}

	if (data.license !== undefined && data.license !== null && typeof data.license !== "string") {
		errors.push({
			code: SkillErrorCodes.INVALID_LICENSE,
			message: "Field 'license' must be a string",
			field: "license",
		});
	}

	if (errors.length > 0) {
		return {
			valid: false,
			errors,
		};
	}

	const frontmatter: SkillFrontmatter = {
		...data,
		name: typeof data.name === "string" ? data.name.trim() : String(data.name),
		description:
			typeof data.description === "string" ? data.description.trim() : String(data.description),
		version: data.version !== undefined ? String(data.version) : undefined,
	};

	const manifest: SkillManifest = {
		frontmatter,
		instructions: markdownBody,
		rawContent: content,
		skillDir: skillDir || "",
		scope: scope || "project",
		hasScripts: false,
		hasReferences: false,
		hasAssets: false,
		scripts: [],
		references: [],
		assets: [],
	};

	return {
		valid: true,
		errors: [],
		manifest,
	};
}
