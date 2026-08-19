import type * as ts from "typescript";

/** Severity category for diagnostics */
export type DiagnosticCategory = "error" | "warning" | "suggestion" | "message";

/** 1-indexed position in a text file */
export interface Position {
	/** 1-indexed line number */
	line: number;
	/** 1-indexed column number */
	column: number;
	/** Optional 0-indexed character offset from beginning of file */
	offset?: number;
}

/** Span range between two positions (1-indexed) */
export interface Range {
	start: Position;
	end: Position;
}

/** Related information for a diagnostic */
export interface DiagnosticRelatedInformation {
	filePath: string;
	line: number;
	column: number;
	message: string;
}

/** Alias for DiagnosticRelatedInformation */
export type DiagnosticRelatedInfo = DiagnosticRelatedInformation;

/** Standardized diagnostic item returned by LSP diagnostics engine */
export interface DiagnosticItem {
	filePath: string;
	category: DiagnosticCategory;
	code: number;
	message: string;
	/** 1-indexed line number */
	line: number;
	/** 1-indexed column number */
	column: number;
	/** Length of diagnostic span in characters */
	length: number;
	/** 1-indexed end line number */
	endLine?: number;
	/** 1-indexed end column number */
	endColumn?: number;
	/** Source compiler, e.g. "typescript" */
	source?: string;
	/** Code preview snippet with line number gutter and caret indicator */
	preview?: string;
	/** Alias for preview */
	sourceSnippet?: string;
	/** Related diagnostics or origin references */
	relatedInformation?: DiagnosticRelatedInformation[];
}

/** Options for filtering and querying diagnostics */
export interface LSPDiagnosticsOptions {
	filePath?: string;
	includeWarnings?: boolean;
	includeSuggestions?: boolean;
	syntacticOnly?: boolean;
	semanticOnly?: boolean;
}

/** Alias for LSPDiagnosticsOptions */
export type DiagnosticsOptions = LSPDiagnosticsOptions;

/** Symbol definition location and metadata */
export interface DefinitionResult {
	filePath: string;
	name: string;
	kind: string; // e.g. "function", "class", "interface", "var", "property", "method"
	/** 1-indexed line number */
	line: number;
	/** 1-indexed column number */
	column: number;
	/** 1-indexed end line number */
	endLine: number;
	/** 1-indexed end column number */
	endColumn: number;
	containerKind?: string;
	containerName?: string;
	/** Code preview snippet at definition */
	preview?: string;
	/** Alias for preview */
	snippet?: string;
	/** JSDoc comment if available */
	docComment?: string;
	isDefinition?: boolean;
}

/** Symbol reference occurrence across project */
export interface ReferenceResult {
	filePath: string;
	/** 1-indexed line number */
	line: number;
	/** 1-indexed column number */
	column: number;
	/** 1-indexed end line number */
	endLine: number;
	/** 1-indexed end column number */
	endColumn: number;
	isWriteAccess: boolean;
	isDefinition: boolean;
	lineText?: string;
	/** Code preview snippet at reference */
	preview?: string;
	/** Alias for preview */
	snippet?: string;
	textSpan?: {
		start: number;
		length: number;
	};
}

/** In-memory tracked file entry */
export interface FileEntry {
	fileName: string;
	content: string;
	version: number;
	snapshot: ts.IScriptSnapshot;
	onDisk?: boolean;
}

/** Configuration options for LanguageServiceHost */
export interface LSPHostConfig {
	projectRoot?: string;
	compilerOptions?: ts.CompilerOptions;
	tsConfigPath?: string;
	useDiskFallback?: boolean;
	files?: Record<string, string>;
}

/** Alias for LSPHostConfig */
export type LanguageServiceHostOptions = LSPHostConfig;
export type LanguageServiceHostConfig = LSPHostConfig;

/** Options for LSPDiagnosticsEngine */
export interface LSPDiagnosticsEngineOptions {
	projectRoot?: string;
	host?: any;
	compilerOptions?: ts.CompilerOptions;
	useDiskFallback?: boolean;
	files?: Record<string, string>;
}

/** High-level error classifications for self-healing */
export type ErrorCategory =
	| "syntax"
	| "missing_import"
	| "type_mismatch"
	| "missing_property"
	| "argument_count"
	| "interface_incomplete"
	| "generic_constraint"
	| "semantic_general"
	| "syntax_error"
	| "property_missing"
	| "unknown";

/** Alias for ErrorCategory */
export type ErrorClassification = ErrorCategory;

export type DiagnosticSeverityLevel = "critical" | "high" | "medium" | "low";

/** Individual categorized error with remediation suggestions */
export interface RemediationSuggestion {
	diagnostic: DiagnosticItem;
	category: ErrorCategory;
	classification: ErrorClassification;
	severity: DiagnosticSeverityLevel;
	targetSymbol?: string;
	suggestedAction: string;
}

/** Alias for RemediationSuggestion */
export type ClassifiedError = RemediationSuggestion;

/** Assessment of current codebase diagnostic health */
export interface SelfHealingAssessment {
	isClean: boolean;
	totalErrors: number;
	totalWarnings: number;
	affectedFiles: string[];
	classifiedErrors: RemediationSuggestion[];
	diagnostics: DiagnosticItem[];
	summary: string;
}

/** Structured remediation plan for agent prompt */
export interface RemediationPlan {
	assessment: SelfHealingAssessment;
	remediationPrompt: string;
	suggestedFixOrder: string[];
	fileBreakdown: Array<{
		filePath: string;
		errors: RemediationSuggestion[];
		formattedPrompt: string;
	}>;
}

/** Outcome comparing pre-edit vs post-edit diagnostics */
export interface VerificationOutcome {
	status: "clean" | "improved" | "regressed" | "unchanged";
	isClean: boolean;
	previousErrorCount: number;
	currentErrorCount: number;
	resolvedErrors: DiagnosticItem[];
	remainingErrors: DiagnosticItem[];
	newErrors: DiagnosticItem[];
}

/** Options for self-healing loops */
export interface SelfHealingOptions {
	maxRounds?: number;
	targetFiles?: string[];
	stopOnFirstClean?: boolean;
	includeWarnings?: boolean;
	logger?: (msg: string) => void;
}

/** Single round execution record in a self-healing loop */
export interface SelfHealingRoundResult {
	round: number;
	assessment: SelfHealingAssessment;
	fixApplied: boolean;
	verification: VerificationOutcome;
}

/** Final comprehensive report produced by SelfHealingCoordinator */
export interface SelfHealingReport {
	success: boolean;
	totalDiagnostics?: number;
	remainingDiagnostics?: number;
	roundsExecuted: number;
	maxRounds?: number;
	initialErrorCount?: number;
	finalErrorCount?: number;
	filesChecked?: string[];
	fixedFiles?: string[];
	diagnostics?: DiagnosticItem[];
	fixedIssues?: DiagnosticItem[];
	resolvedErrors?: DiagnosticItem[];
	remainingErrors?: DiagnosticItem[];
	history?: SelfHealingRoundResult[];
	finalAssessment?: SelfHealingAssessment;
	summary: string;
}
