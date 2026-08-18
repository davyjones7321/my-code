/**
 * Portable Skills System (agentskills.io compatible) - Core Type Definitions
 */

/**
 * agentskills.io YAML frontmatter schema
 */
export interface SkillFrontmatter {
	/** Unique skill identifier (kebab-case / lowercase alphanumeric with hyphens/underscores) */
	name: string;

	/** Human-readable explanation of capability and usage trigger conditions */
	description: string;

	/** Semantic version string (e.g. "1.0.0") */
	version?: string;

	/** Category or domain tags for categorization and search */
	tags?: string[];

	/** Keywords or intent phrases that trigger this skill */
	triggers?: string[];

	/** Skill author / maintainer name or identifier */
	author?: string;

	/** Open source or proprietary license identifier (e.g. "MIT", "Apache-2.0") */
	license?: string;

	/** Skill dependencies */
	dependencies?: string[] | Record<string, string>;

	/** Optional arbitrary metadata key-value mappings */
	metadata?: Record<string, unknown>;

	/** Allow custom extra frontmatter properties */
	[key: string]: unknown;
}

/**
 * Fully resolved skill manifest loaded in memory
 */
export interface SkillManifest {
	/** Parsed frontmatter metadata */
	frontmatter: SkillFrontmatter;

	/** Markdown procedural instructions (body after frontmatter) */
	instructions: string;

	/** Full raw text of SKILL.md */
	rawContent: string;

	/** Absolute path to the skill directory root */
	skillDir: string;

	/** Origin scope of the skill */
	scope: "project" | "global";

	/** Whether the skill contains an executable scripts/ subdirectory */
	hasScripts: boolean;

	/** Whether the skill contains an extended references/ subdirectory */
	hasReferences: boolean;

	/** Whether the skill contains a templates/assets/ subdirectory */
	hasAssets: boolean;

	/** Array of file names or relative paths inside scripts/ */
	scripts: string[];

	/** Array of file names or relative paths inside references/ */
	references: string[];

	/** Array of file names or relative paths inside assets/ */
	assets: string[];
}

/**
 * Lightweight skill index entry for progressive discovery (~20-40 tokens)
 */
export interface SkillIndexEntry {
	/** Unique skill identifier matching frontmatter.name */
	name: string;

	/** Skill description used for LLM discovery indexing */
	description: string;

	/** Scope where skill was discovered */
	scope: "project" | "global";

	/** Absolute directory path of the skill package */
	skillDir: string;

	/** Optional trigger phrases */
	triggers?: string[];

	/** Optional version */
	version?: string;
}

/**
 * Standard diagnostic error codes emitted during skill parsing and validation
 */
export const SkillErrorCodes = {
	// Directory & Filesystem errors
	NOT_FOUND: "ERR_SKILL_NOT_FOUND",
	NOT_A_DIRECTORY: "ERR_SKILL_NOT_A_DIRECTORY",
	MISSING_SKILL_MD: "ERR_SKILL_MISSING_SKILL_MD",
	INVALID_SUBDIRECTORY: "ERR_SKILL_INVALID_SUBDIRECTORY",
	READ_ERROR: "ERR_SKILL_READ_ERROR",

	// Frontmatter & Schema errors
	INVALID_DELIMITER: "ERR_SKILL_INVALID_DELIMITER",
	INVALID_FRONTMATTER: "ERR_SKILL_INVALID_FRONTMATTER",
	INVALID_YAML: "ERR_SKILL_INVALID_YAML",
	MISSING_NAME: "ERR_SKILL_MISSING_NAME",
	INVALID_NAME: "ERR_SKILL_INVALID_NAME",
	MISSING_DESCRIPTION: "ERR_SKILL_MISSING_DESCRIPTION",
	EMPTY_DESCRIPTION: "ERR_SKILL_EMPTY_DESCRIPTION",
	INVALID_DESCRIPTION: "ERR_SKILL_INVALID_DESCRIPTION",
	INVALID_VERSION: "ERR_SKILL_INVALID_VERSION",
	INVALID_TAGS: "ERR_SKILL_INVALID_TAGS",
	INVALID_TRIGGERS: "ERR_SKILL_INVALID_TRIGGERS",
	INVALID_AUTHOR: "ERR_SKILL_INVALID_AUTHOR",
	INVALID_LICENSE: "ERR_SKILL_INVALID_LICENSE",
	INVALID_DEPENDENCIES: "ERR_SKILL_INVALID_DEPENDENCIES",
	INVALID_METADATA: "ERR_SKILL_INVALID_METADATA",
} as const;

export type SkillErrorCode = (typeof SkillErrorCodes)[keyof typeof SkillErrorCodes];

/**
 * Structured diagnostic validation error
 */
export interface SkillValidationError {
	/** Diagnostic error code */
	code: SkillErrorCode | string;

	/** Descriptive, actionable error message */
	message: string;

	/** File path where error occurred (if applicable) */
	path?: string;

	/** Line number (1-based) where syntax error or violation occurred (if applicable) */
	line?: number;

	/** Field name associated with the error (if applicable) */
	field?: string;
}

/**
 * Result returned by schema parser and directory validator
 */
export interface SkillValidationResult {
	/** True if validation succeeded with zero fatal errors */
	valid: boolean;

	/** Array of diagnostic error details */
	errors: SkillValidationError[];

	/** Fully constructed manifest (present if valid === true) */
	manifest?: SkillManifest;
}
