import type { LSPDiagnosticsEngine } from "./engine.ts";
import type {
	DiagnosticItem,
	DiagnosticSeverityLevel,
	ErrorCategory,
	RemediationPlan,
	RemediationSuggestion,
	SelfHealingAssessment,
	SelfHealingOptions,
	SelfHealingReport,
	SelfHealingRoundResult,
	VerificationOutcome,
} from "./types.ts";

export class SelfHealingCoordinator {
	constructor(private readonly engine: LSPDiagnosticsEngine) {}

	/**
	 * Perform a fast diagnostic check on given files or whole project.
	 */
	public async quickScan(filePaths?: string[]): Promise<{
		isClean: boolean;
		errorCount: number;
		diagnostics: DiagnosticItem[];
		summary: string;
	}> {
		const diagnostics = await this.collectDiagnostics(filePaths);
		const errors = diagnostics.filter((d) => d.category === "error");
		return {
			isClean: errors.length === 0,
			errorCount: errors.length,
			diagnostics,
			summary:
				errors.length === 0
					? "No compiler errors detected. Code is clean."
					: `Found ${errors.length} compiler error(s) across project files.`,
		};
	}

	/**
	 * Assess current codebase error state and return categorized errors.
	 */
	public async assess(filePaths?: string[]): Promise<SelfHealingAssessment> {
		const allDiagnostics = await this.collectDiagnostics(filePaths);
		const errors = allDiagnostics.filter((d) => d.category === "error");
		const warnings = allDiagnostics.filter((d) => d.category === "warning");

		const classifiedErrors = this.generateRemediations(errors);
		const affectedFiles = Array.from(new Set(errors.map((e) => e.filePath)));

		return {
			isClean: errors.length === 0,
			totalErrors: errors.length,
			totalWarnings: warnings.length,
			affectedFiles,
			classifiedErrors,
			diagnostics: allDiagnostics,
			summary:
				errors.length === 0
					? "No compiler errors detected. Project is clean."
					: `Found ${errors.length} compiler error(s) across ${affectedFiles.length} file(s).`,
		};
	}

	/**
	 * Classify diagnostic items into structured remediation suggestions with priority.
	 */
	public generateRemediations(
		diagnostics: DiagnosticItem[],
	): RemediationSuggestion[] {
		const classified = diagnostics.map((diag) => this.classifyDiagnostic(diag));

		// Sort by severity: critical (syntax) first, then high, then medium, then low
		const severityOrder: Record<DiagnosticSeverityLevel, number> = {
			critical: 0,
			high: 1,
			medium: 2,
			low: 3,
		};

		return classified.sort((a, b) => {
			const diff = severityOrder[a.severity] - severityOrder[b.severity];
			if (diff !== 0) return diff;
			if (a.diagnostic.filePath !== b.diagnostic.filePath) {
				return a.diagnostic.filePath.localeCompare(b.diagnostic.filePath);
			}
			return a.diagnostic.line - b.diagnostic.line;
		});
	}

	/**
	 * Classify a single diagnostic into an actionable remediation suggestion.
	 */
	public classifyDiagnostic(diag: DiagnosticItem): RemediationSuggestion {
		const { code, message } = diag;

		// Syntax errors (TS1000 - TS1999)
		if (code >= 1000 && code < 2000) {
			return {
				diagnostic: diag,
				category: "syntax",
				classification: "syntax",
				severity: "critical",
				suggestedAction:
					"Fix syntax error: check for missing or unclosed brackets, parentheses, semicolons, or invalid syntax keywords.",
			};
		}

		// Missing imports or unresolved identifier names
		if (code === 2304 || code === 2552) {
			const match = message.match(/Cannot find name '([^']+)'/);
			const symbol = match ? match[1] : undefined;
			return {
				diagnostic: diag,
				category: "missing_import",
				classification: "missing_import",
				severity: "high",
				targetSymbol: symbol,
				suggestedAction: symbol
					? `Import '${symbol}' from its declaring module, or declare it in scope.`
					: "Add missing import declaration or define the unresolved identifier.",
			};
		}

		if (code === 2307 || code === 2792) {
			const match = message.match(/Cannot find module '([^']+)'/);
			const moduleName = match ? match[1] : undefined;
			return {
				diagnostic: diag,
				category: "missing_import",
				classification: "missing_import",
				severity: "high",
				targetSymbol: moduleName,
				suggestedAction: moduleName
					? `Verify file path and export for module '${moduleName}'. Ensure relative paths start with './' or '../'.`
					: "Verify import path and target file existence.",
			};
		}

		// Type mismatches
		if (code === 2322 || code === 2345) {
			return {
				diagnostic: diag,
				category: "type_mismatch",
				classification: "type_mismatch",
				severity: "high",
				suggestedAction:
					"Align assigned value or parameter type with expected type contract. Cast, convert, or update interface definition.",
			};
		}

		// Missing properties
		if (code === 2339 || code === 2551) {
			const match = message.match(/Property '([^']+)' does not exist on type/);
			const prop = match ? match[1] : undefined;
			return {
				diagnostic: diag,
				category: "missing_property",
				classification: "missing_property",
				severity: "medium",
				targetSymbol: prop,
				suggestedAction: prop
					? `Verify property '${prop}' exists on target type or add it to interface/class definition.`
					: "Ensure referenced property is defined on object type.",
			};
		}

		// Argument count mismatch
		if (code === 2554 || code === 2555) {
			return {
				diagnostic: diag,
				category: "argument_count",
				classification: "argument_count",
				severity: "medium",
				suggestedAction:
					"Pass required number of arguments to function call or mark optional parameters with '?'.",
			};
		}

		// Incomplete interface implementation
		if (code === 2420) {
			return {
				diagnostic: diag,
				category: "interface_incomplete",
				classification: "interface_incomplete",
				severity: "high",
				suggestedAction:
					"Implement all missing methods and properties required by the interface.",
			};
		}

		// Generic constraints
		if (code === 2344) {
			return {
				diagnostic: diag,
				category: "generic_constraint",
				classification: "generic_constraint",
				severity: "medium",
				suggestedAction:
					"Ensure generic type parameter satisfies the specified constraint ('extends').",
			};
		}

		// Semantic general fallback
		return {
			diagnostic: diag,
			category: "semantic_general",
			classification: "semantic_general",
			severity: "medium",
			suggestedAction:
				"Review compiler error message and adjust TypeScript code.",
		};
	}

	/**
	 * Generate an LLM-optimized Markdown diagnosis prompt.
	 */
	public generateDiagnosisPrompt(diagnostics: DiagnosticItem[]): string {
		const errors = diagnostics.filter((d) => d.category === "error");
		if (errors.length === 0) {
			return "No compiler errors detected. Project is clean.";
		}

		const suggestions = this.generateRemediations(errors);
		const affectedFiles = Array.from(new Set(errors.map((e) => e.filePath)));

		const fileMap = new Map<string, RemediationSuggestion[]>();
		for (const sug of suggestions) {
			const arr = fileMap.get(sug.diagnostic.filePath) ?? [];
			arr.push(sug);
			fileMap.set(sug.diagnostic.filePath, arr);
		}

		const sections: string[] = [
			`### 🚨 TypeScript Compiler Diagnostics Found (${errors.length} error(s) across ${affectedFiles.length} file(s))`,
			"Please resolve each compiler error in the priority order listed below. Syntax errors must be resolved first as they may cause cascading type errors.",
			"",
		];

		for (const [filePath, fileSuggestions] of fileMap.entries()) {
			sections.push(
				`#### File: \`${filePath}\` (${fileSuggestions.length} error(s))`,
			);
			fileSuggestions.forEach((sug, idx) => {
				const d = sug.diagnostic;
				sections.push(
					`${idx + 1}. **Line ${d.line}, Column ${d.column}** [TS${d.code}: ${d.message}] (${sug.severity.toUpperCase()} - ${sug.category})`,
				);
				if (d.preview) {
					sections.push("```typescript");
					sections.push(d.preview);
					sections.push("```");
				}
				sections.push(`   - **Suggested Fix**: ${sug.suggestedAction}`);
				sections.push("");
			});
		}

		return sections.join("\n").trimEnd();
	}

	/**
	 * Create a full remediation plan from an assessment.
	 */
	public createRemediationPlan(
		assessment: SelfHealingAssessment,
	): RemediationPlan {
		if (assessment.isClean) {
			return {
				assessment,
				remediationPrompt: "No compiler errors detected. Project is clean.",
				suggestedFixOrder: [],
				fileBreakdown: [],
			};
		}

		// Sort files by priority: syntax error files first, then count descending
		const filesByPriority = [...assessment.affectedFiles].sort((a, b) => {
			const aErrors = assessment.classifiedErrors.filter(
				(e) => e.diagnostic.filePath === a,
			);
			const bErrors = assessment.classifiedErrors.filter(
				(e) => e.diagnostic.filePath === b,
			);
			const aHasSyntax = aErrors.some((e) => e.category === "syntax");
			const bHasSyntax = bErrors.some((e) => e.category === "syntax");

			if (aHasSyntax && !bHasSyntax) return -1;
			if (!aHasSyntax && bHasSyntax) return 1;
			return bErrors.length - aErrors.length;
		});

		const fileBreakdown = filesByPriority.map((filePath) => {
			const fileErrors = assessment.classifiedErrors.filter(
				(e) => e.diagnostic.filePath === filePath,
			);
			const errorLines = fileErrors.map((err, idx) => {
				const d = err.diagnostic;
				const snippetBlock = d.preview
					? `\n\`\`\`typescript\n${d.preview}\n\`\`\``
					: "";
				return `${idx + 1}. **Line ${d.line}, Column ${d.column}** [TS${d.code}: ${d.message}] (${err.severity.toUpperCase()} - ${err.category})${snippetBlock}\n   - **Suggested Fix**: ${err.suggestedAction}`;
			});

			return {
				filePath,
				errors: fileErrors,
				formattedPrompt: `### File: \`${filePath}\` (${fileErrors.length} error(s))\n${errorLines.join("\n\n")}`,
			};
		});

		const prompt = this.generateDiagnosisPrompt(assessment.diagnostics);

		return {
			assessment,
			remediationPrompt: prompt,
			suggestedFixOrder: filesByPriority,
			fileBreakdown,
		};
	}

	/**
	 * Verify diagnostics delta before and after an edit.
	 */
	public verifyRemediation(
		preDiagnostics: DiagnosticItem[],
		postDiagnostics: DiagnosticItem[],
	): VerificationOutcome {
		const prevErrors = preDiagnostics.filter((d) => d.category === "error");
		const currErrors = postDiagnostics.filter((d) => d.category === "error");

		const resolvedErrors: DiagnosticItem[] = [];
		const remainingErrors: DiagnosticItem[] = [];
		const newErrors: DiagnosticItem[] = [];

		for (const prev of prevErrors) {
			const stillPresent = currErrors.find(
				(c) =>
					c.filePath === prev.filePath &&
					c.line === prev.line &&
					c.code === prev.code,
			);
			if (stillPresent) {
				remainingErrors.push(stillPresent);
			} else {
				resolvedErrors.push(prev);
			}
		}

		for (const curr of currErrors) {
			const existedBefore = prevErrors.some(
				(p) =>
					p.filePath === curr.filePath &&
					p.line === curr.line &&
					p.code === curr.code,
			);
			if (!existedBefore) {
				newErrors.push(curr);
			}
		}

		let status: "clean" | "improved" | "regressed" | "unchanged" = "unchanged";
		if (currErrors.length === 0) {
			status = "clean";
		} else if (newErrors.length > 0) {
			status = "regressed";
		} else if (
			resolvedErrors.length > 0 &&
			currErrors.length < prevErrors.length
		) {
			status = "improved";
		}

		return {
			status,
			isClean: currErrors.length === 0,
			previousErrorCount: prevErrors.length,
			currentErrorCount: currErrors.length,
			resolvedErrors,
			remainingErrors,
			newErrors,
		};
	}

	/**
	 * Compare assessment before edit against current project state.
	 */
	public async verify(
		previousAssessment: SelfHealingAssessment,
		filePaths?: string[],
	): Promise<VerificationOutcome> {
		const currentAssessment = await this.assess(filePaths);
		return this.verifyRemediation(
			previousAssessment.diagnostics,
			currentAssessment.diagnostics,
		);
	}

	/**
	 * Run a multi-round remediation loop using a custom remediation callback.
	 */
	public async checkAndRemediate(
		filePaths: string[],
		remediationFn: (
			prompt: string,
			suggestions: RemediationSuggestion[],
		) => Promise<void>,
		maxRounds = 3,
	): Promise<SelfHealingReport> {
		const history: SelfHealingRoundResult[] = [];
		const fixedFilesSet = new Set<string>();

		const initialAssessment = await this.assess(filePaths);
		if (initialAssessment.isClean) {
			return {
				success: true,
				totalDiagnostics: 0,
				remainingDiagnostics: 0,
				roundsExecuted: 0,
				maxRounds,
				initialErrorCount: 0,
				finalErrorCount: 0,
				filesChecked: filePaths,
				fixedFiles: [],
				diagnostics: [],
				fixedIssues: [],
				resolvedErrors: [],
				remainingErrors: [],
				history: [],
				finalAssessment: initialAssessment,
				summary: "No compiler errors detected. Code is clean.",
			};
		}

		let currentAssessment = initialAssessment;

		for (let round = 1; round <= maxRounds; round++) {
			const prompt = this.generateDiagnosisPrompt(
				currentAssessment.diagnostics,
			);
			await remediationFn(prompt, currentAssessment.classifiedErrors);

			const verification = await this.verify(currentAssessment, filePaths);

			for (const file of currentAssessment.affectedFiles) {
				if (!verification.remainingErrors.some((e) => e.filePath === file)) {
					fixedFilesSet.add(file);
				}
			}

			history.push({
				round,
				assessment: currentAssessment,
				fixApplied: true,
				verification,
			});

			currentAssessment = await this.assess(filePaths);

			if (verification.isClean) {
				return {
					success: true,
					totalDiagnostics: initialAssessment.totalErrors,
					remainingDiagnostics: 0,
					roundsExecuted: round,
					maxRounds,
					initialErrorCount: initialAssessment.totalErrors,
					finalErrorCount: 0,
					filesChecked: filePaths,
					fixedFiles: Array.from(fixedFilesSet),
					diagnostics: currentAssessment.diagnostics,
					fixedIssues: verification.resolvedErrors,
					resolvedErrors: verification.resolvedErrors,
					remainingErrors: [],
					history,
					finalAssessment: currentAssessment,
					summary: `Self-healing successfully resolved all ${initialAssessment.totalErrors} error(s) in ${round} round(s).`,
				};
			}
		}

		return {
			success: false,
			totalDiagnostics: initialAssessment.totalErrors,
			remainingDiagnostics: currentAssessment.totalErrors,
			roundsExecuted: history.length,
			maxRounds,
			initialErrorCount: initialAssessment.totalErrors,
			finalErrorCount: currentAssessment.totalErrors,
			filesChecked: filePaths,
			fixedFiles: Array.from(fixedFilesSet),
			diagnostics: currentAssessment.diagnostics,
			fixedIssues: history[history.length - 1]?.verification.resolvedErrors ?? [],
			resolvedErrors:
				history[history.length - 1]?.verification.resolvedErrors ?? [],
			remainingErrors: currentAssessment.diagnostics.filter(
				(d) => d.category === "error",
			),
			history,
			finalAssessment: currentAssessment,
			summary: `Self-healing completed ${history.length} round(s) with ${currentAssessment.totalErrors} remaining error(s).`,
		};
	}

	/**
	 * Coordinate loop supporting RemediationPlan callback.
	 */
	public async coordinateLoop(
		fixCallback: (plan: RemediationPlan) => Promise<boolean>,
		options: SelfHealingOptions = {},
	): Promise<SelfHealingReport> {
		const maxRounds = options.maxRounds ?? 3;
		const history: SelfHealingRoundResult[] = [];
		const fixedFilesSet = new Set<string>();

		const initialAssessment = await this.assess(options.targetFiles);
		if (initialAssessment.isClean) {
			return {
				success: true,
				totalDiagnostics: 0,
				remainingDiagnostics: 0,
				roundsExecuted: 0,
				maxRounds,
				initialErrorCount: 0,
				finalErrorCount: 0,
				filesChecked: options.targetFiles || [],
				fixedFiles: [],
				diagnostics: [],
				fixedIssues: [],
				resolvedErrors: [],
				remainingErrors: [],
				history: [],
				finalAssessment: initialAssessment,
				summary: "No compiler errors detected. Project is clean.",
			};
		}

		let currentAssessment = initialAssessment;

		for (let round = 1; round <= maxRounds; round++) {
			const plan = this.createRemediationPlan(currentAssessment);
			const fixApplied = await fixCallback(plan);
			if (!fixApplied) {
				break;
			}

			const verification = await this.verify(
				currentAssessment,
				options.targetFiles,
			);

			for (const file of currentAssessment.affectedFiles) {
				if (!verification.remainingErrors.some((e) => e.filePath === file)) {
					fixedFilesSet.add(file);
				}
			}

			history.push({
				round,
				assessment: currentAssessment,
				fixApplied,
				verification,
			});

			currentAssessment = await this.assess(options.targetFiles);

			if (verification.isClean) {
				return {
					success: true,
					totalDiagnostics: initialAssessment.totalErrors,
					remainingDiagnostics: 0,
					roundsExecuted: round,
					maxRounds,
					initialErrorCount: initialAssessment.totalErrors,
					finalErrorCount: 0,
					filesChecked: options.targetFiles || [],
					fixedFiles: Array.from(fixedFilesSet),
					diagnostics: currentAssessment.diagnostics,
					fixedIssues: verification.resolvedErrors,
					resolvedErrors: verification.resolvedErrors,
					remainingErrors: [],
					history,
					finalAssessment: currentAssessment,
					summary: `Self-healing successfully resolved all ${initialAssessment.totalErrors} error(s) in ${round} round(s).`,
				};
			}
		}

		return {
			success: false,
			totalDiagnostics: initialAssessment.totalErrors,
			remainingDiagnostics: currentAssessment.totalErrors,
			roundsExecuted: history.length,
			maxRounds,
			initialErrorCount: initialAssessment.totalErrors,
			finalErrorCount: currentAssessment.totalErrors,
			filesChecked: options.targetFiles || [],
			fixedFiles: Array.from(fixedFilesSet),
			diagnostics: currentAssessment.diagnostics,
			fixedIssues:
				history[history.length - 1]?.verification.resolvedErrors ?? [],
			resolvedErrors:
				history[history.length - 1]?.verification.resolvedErrors ?? [],
			remainingErrors: currentAssessment.diagnostics.filter(
				(d) => d.category === "error",
			),
			history,
			finalAssessment: currentAssessment,
			summary: `Self-healing completed ${history.length} round(s) with ${currentAssessment.totalErrors} remaining error(s).`,
		};
	}

	private async collectDiagnostics(
		filePaths?: string[],
	): Promise<DiagnosticItem[]> {
		if (filePaths && filePaths.length > 0) {
			const items: DiagnosticItem[] = [];
			for (const file of filePaths) {
				const diags = await this.engine.getDiagnostics(file);
				items.push(...diags);
			}
			return items;
		}
		return this.engine.getDiagnostics();
	}
}
