// Core Engine, Host, and Self-Healing Coordinator
export {
	LSPDiagnosticsEngine,
} from "./engine.ts";
export {
	DEFAULT_COMPILER_OPTIONS,
	InMemoryLanguageServiceHost,
	normalizeFilePath,
} from "./host.ts";
export {
	SelfHealingCoordinator,
} from "./self-healing.ts";

// Tool factories and registry helpers
export {
	createFindReferencesTool,
	createGetDefinitionTool,
	createGetDiagnosticsTool,
	createLSPTools,
	registerLSPTools,
} from "./tools.ts";

// Comprehensive Types
export type {
	ClassifiedError,
	DefinitionResult,
	DiagnosticCategory,
	DiagnosticItem,
	DiagnosticRelatedInfo,
	DiagnosticRelatedInformation,
	DiagnosticSeverityLevel,
	DiagnosticsOptions,
	ErrorCategory,
	ErrorClassification,
	FileEntry,
	LanguageServiceHostConfig,
	LanguageServiceHostOptions,
	LSPDiagnosticsEngineOptions,
	LSPDiagnosticsOptions,
	LSPHostConfig,
	Position,
	Range,
	ReferenceResult,
	RemediationPlan,
	RemediationSuggestion,
	SelfHealingAssessment,
	SelfHealingOptions,
	SelfHealingReport,
	SelfHealingRoundResult,
	VerificationOutcome,
} from "./types.ts";
