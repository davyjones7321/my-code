import * as path from "node:path";
import ts from "typescript";
import { InMemoryLanguageServiceHost, normalizeFilePath } from "./host.ts";
import type {
	DefinitionResult,
	DiagnosticCategory,
	DiagnosticItem,
	DiagnosticRelatedInformation,
	LSPDiagnosticsEngineOptions,
	LSPDiagnosticsOptions,
	ReferenceResult,
} from "./types.ts";

export class LSPDiagnosticsEngine {
	private projectRoot: string;
	private host: InMemoryLanguageServiceHost;

	constructor(options: LSPDiagnosticsEngineOptions = {}) {
		this.projectRoot = normalizeFilePath(options.projectRoot || process.cwd());
		if (options.host) {
			this.host = options.host;
		} else {
			this.host = new InMemoryLanguageServiceHost({
				projectRoot: this.projectRoot,
				compilerOptions: options.compilerOptions,
				useDiskFallback: options.useDiskFallback ?? true,
				files: options.files,
			});
		}
	}

	public getHost(): InMemoryLanguageServiceHost {
		return this.host;
	}

	public getLanguageService(): ts.LanguageService {
		return this.host.getLanguageService();
	}

	public updateFile(filePath: string, content?: string): void {
		this.host.addOrUpdateFile(filePath, content);
	}

	public removeFile(filePath: string): void {
		this.host.deleteFile(filePath);
	}

	public getProjectFiles(): string[] {
		return this.host.getFileNames();
	}

	public dispose(): void {
		this.host.dispose();
	}

	/**
	 * Retrieve compiler diagnostics for a specific file or the entire project.
	 */
	public async getDiagnostics(
		filePath?: string,
		options: LSPDiagnosticsOptions = {},
	): Promise<DiagnosticItem[]> {
		const service = this.getLanguageService();
		const items: DiagnosticItem[] = [];

		if (filePath) {
			const norm = this.normalizeFilePath(filePath);
			if (!this.host.hasFile(norm)) {
				this.host.addOrUpdateFile(norm);
			}

			const syntactic = options.semanticOnly
				? []
				: service.getSyntacticDiagnostics(norm);
			const semantic = options.syntacticOnly
				? []
				: service.getSemanticDiagnostics(norm);
			const suggestion =
				options.includeSuggestions && !options.syntacticOnly
					? service.getSuggestionDiagnostics(norm)
					: [];

			const all = [...syntactic, ...semantic, ...suggestion];
			for (const diag of all) {
				const item = this.transformDiagnostic(diag);
				if (this.filterDiagnostic(item, options)) {
					items.push(item);
				}
			}
		} else {
			const files = this.host.getFileNames();
			for (const file of files) {
				// Exclude declaration files from external packages unless specified
				if (file.includes("node_modules") || file.endsWith(".d.ts")) {
					continue;
				}

				const syntactic = options.semanticOnly
					? []
					: service.getSyntacticDiagnostics(file);
				const semantic = options.syntacticOnly
					? []
					: service.getSemanticDiagnostics(file);
				const suggestion =
					options.includeSuggestions && !options.syntacticOnly
						? service.getSuggestionDiagnostics(file)
						: [];

				const all = [...syntactic, ...semantic, ...suggestion];
				for (const diag of all) {
					const item = this.transformDiagnostic(diag);
					if (this.filterDiagnostic(item, options)) {
						items.push(item);
					}
				}
			}
		}

		return items;
	}

	/**
	 * Get formatted human/LLM diagnostic output with line numbers and caret pointers.
	 */
	public async getDiagnosticsFormatted(
		filePath?: string,
		options?: LSPDiagnosticsOptions,
	): Promise<string> {
		const items = await this.getDiagnostics(filePath, options);
		const displayPath = filePath ? this.toRelativePath(filePath) : undefined;

		if (items.length === 0) {
			return displayPath
				? `No diagnostic errors found in ${displayPath}.`
				: "No diagnostic errors found across project.";
		}

		const lines: string[] = [
			`Found ${items.length} diagnostic(s)${displayPath ? ` in ${displayPath}` : ""}:`,
			"",
		];

		items.forEach((item, index) => {
			const categoryTag =
				item.category.charAt(0).toUpperCase() + item.category.slice(1);
			lines.push(
				`${index + 1}. [${categoryTag} TS${item.code}] ${item.filePath}:${item.line}:${item.column}`,
			);
			lines.push(`   ${item.message}`);
			if (item.preview) {
				lines.push("");
				const indentedSnippet = item.preview
					.split("\n")
					.map((l) => `   ${l}`)
					.join("\n");
				lines.push(indentedSnippet);
			}
			if (item.relatedInformation && item.relatedInformation.length > 0) {
				lines.push("   Related information:");
				for (const rel of item.relatedInformation) {
					lines.push(
						`   - ${rel.filePath}:${rel.line}:${rel.column} — ${rel.message}`,
					);
				}
			}
			lines.push("");
		});

		return lines.join("\n").trimEnd();
	}

	/** Alias for getDiagnosticsFormatted */
	public async getFormattedDiagnostics(
		filePath?: string,
		options?: LSPDiagnosticsOptions,
	): Promise<string> {
		return this.getDiagnosticsFormatted(filePath, options);
	}

	/**
	 * Resolve symbol definition for a symbol at a 1-based position.
	 */
	public async getDefinition(
		filePath: string,
		line: number,
		column: number,
	): Promise<DefinitionResult[]> {
		if (line < 1 || column < 1) {
			return [];
		}

		const norm = this.normalizeFilePath(filePath);
		if (!this.host.hasFile(norm)) {
			this.host.addOrUpdateFile(norm);
		}

		const service = this.getLanguageService();
		const program = service.getProgram();
		const sourceFile = program?.getSourceFile(norm);
		if (!sourceFile) {
			return [];
		}

		let position: number;
		try {
			position = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);
		} catch {
			return [];
		}

		if (this.isNonSymbolToken(sourceFile, position)) {
			return [];
		}

		const defAndSpan = service.getDefinitionAndBoundSpan(norm, position);
		const definitions =
			defAndSpan?.definitions ?? service.getDefinitionAtPosition(norm, position);

		if (!definitions || definitions.length === 0) {
			return [];
		}

		const results: DefinitionResult[] = [];
		for (const def of definitions) {
			const targetSourceFile = program?.getSourceFile(def.fileName);
			let targetLine = 1;
			let targetCol = 1;
			let targetEndLine = 1;
			let targetEndCol = 1;
			let preview: string | undefined;

			if (targetSourceFile) {
				const startLoc = targetSourceFile.getLineAndCharacterOfPosition(
					def.textSpan.start,
				);
				const endLoc = targetSourceFile.getLineAndCharacterOfPosition(
					def.textSpan.start + def.textSpan.length,
				);
				targetLine = startLoc.line + 1;
				targetCol = startLoc.character + 1;
				targetEndLine = endLoc.line + 1;
				targetEndCol = endLoc.character + 1;

				preview = this.extractContextSnippet(targetSourceFile, startLoc.line, 2);
			}

			results.push({
				filePath: this.toRelativePath(def.fileName),
				name: def.name,
				kind: def.kind,
				line: targetLine,
				column: targetCol,
				endLine: targetEndLine,
				endColumn: targetEndCol,
				containerKind: def.containerKind,
				containerName: def.containerName,
				preview,
				snippet: preview,
				isDefinition: true,
			});
		}

		return results;
	}

	/**
	 * Get formatted human/LLM definition output.
	 */
	public async getDefinitionFormatted(
		filePath: string,
		line: number,
		column: number,
	): Promise<string> {
		const results = await this.getDefinition(filePath, line, column);
		const relPath = this.toRelativePath(filePath);

		if (results.length === 0) {
			return `No definition found for symbol at ${relPath}:${line}:${column}.`;
		}

		const lines: string[] = [
			`Found ${results.length} definition(s) for symbol at ${relPath}:${line}:${column}:`,
			"",
		];

		results.forEach((def, index) => {
			const containerInfo =
				def.containerName &&
				def.containerKind &&
				def.containerKind !== "module" &&
				!def.containerName.startsWith('"')
					? ` in ${def.containerName}`
					: "";
			lines.push(
				`${index + 1}. Symbol: ${def.name} (${def.kind}${containerInfo})`,
			);
			lines.push(`   Location: ${def.filePath}:${def.line}:${def.column}`);
			if (def.preview) {
				lines.push("   Preview:");
				const indented = def.preview
					.split("\n")
					.map((l) => `     ${l}`)
					.join("\n");
				lines.push(indented);
			}
			lines.push("");
		});

		return lines.join("\n").trimEnd();
	}

	/** Alias for getDefinitionFormatted */
	public async getFormattedDefinition(
		filePath: string,
		line: number,
		column: number,
	): Promise<string> {
		return this.getDefinitionFormatted(filePath, line, column);
	}

	/**
	 * Find all usages and references of a symbol across the project.
	 */
	public async findReferences(
		filePath: string,
		line: number,
		column: number,
	): Promise<ReferenceResult[]> {
		if (line < 1 || column < 1) {
			return [];
		}

		const norm = this.normalizeFilePath(filePath);
		if (!this.host.hasFile(norm)) {
			this.host.addOrUpdateFile(norm);
		}

		const service = this.getLanguageService();
		const program = service.getProgram();
		const sourceFile = program?.getSourceFile(norm);
		if (!sourceFile) {
			return [];
		}

		let position: number;
		try {
			position = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);
		} catch {
			return [];
		}

		if (this.isNonSymbolToken(sourceFile, position)) {
			return [];
		}

		const referencedSymbols = service.findReferences(norm, position);
		if (!referencedSymbols || referencedSymbols.length === 0) {
			return [];
		}

		const results: ReferenceResult[] = [];
		for (const refGroup of referencedSymbols) {
			for (const entry of refGroup.references) {
				const refSourceFile = program?.getSourceFile(entry.fileName);
				let refLine = 1;
				let refCol = 1;
				let refEndLine = 1;
				let refEndCol = 1;
				let lineText = "";
				let preview = "";

				if (refSourceFile) {
					const startLoc = refSourceFile.getLineAndCharacterOfPosition(
						entry.textSpan.start,
					);
					const endLoc = refSourceFile.getLineAndCharacterOfPosition(
						entry.textSpan.start + entry.textSpan.length,
					);
					refLine = startLoc.line + 1;
					refCol = startLoc.character + 1;
					refEndLine = endLoc.line + 1;
					refEndCol = endLoc.character + 1;

					const fileLines = refSourceFile.text.split(/\r?\n/);
					lineText = fileLines[startLoc.line] ?? "";
					preview = `${String(refLine).padStart(4, " ")} | ${lineText}`;
				}

				results.push({
					filePath: this.toRelativePath(entry.fileName),
					line: refLine,
					column: refCol,
					endLine: refEndLine,
					endColumn: refEndCol,
					isWriteAccess: !!entry.isWriteAccess,
					isDefinition: !!entry.isDefinition,
					lineText: lineText.trim(),
					preview,
					snippet: preview,
					textSpan: {
						start: entry.textSpan.start,
						length: entry.textSpan.length,
					},
				});
			}
		}

		return results;
	}

	/**
	 * Get formatted human/LLM reference output.
	 */
	public async findReferencesFormatted(
		filePath: string,
		line: number,
		column: number,
	): Promise<string> {
		const results = await this.findReferences(filePath, line, column);
		const relPath = this.toRelativePath(filePath);

		if (results.length === 0) {
			return `No references found for symbol at ${relPath}:${line}:${column}.`;
		}

		const lines: string[] = [
			`Found ${results.length} reference(s) for symbol at ${relPath}:${line}:${column}:`,
			"",
		];

		results.forEach((ref, index) => {
			const tag = ref.isDefinition
				? "[definition]"
				: ref.isWriteAccess
					? "[write]"
					: "[reference]";
			lines.push(
				`${index + 1}. ${ref.filePath}:${ref.line}:${ref.column} ${tag}`,
			);
			if (ref.preview) {
				lines.push(`   ${ref.preview}`);
			}
			lines.push("");
		});

		return lines.join("\n").trimEnd();
	}

	/** Alias for findReferencesFormatted */
	public async getFormattedReferences(
		filePath: string,
		line: number,
		column: number,
	): Promise<string> {
		return this.findReferencesFormatted(filePath, line, column);
	}

	// --- Helper Methods ---

	private transformDiagnostic(diag: ts.Diagnostic): DiagnosticItem {
		let line = 1;
		let column = 1;
		let endLine = 1;
		let endColumn = 1;
		const length = diag.length ?? 1;
		let preview: string | undefined;
		const filePath = diag.file
			? this.toRelativePath(diag.file.fileName)
			: "project";

		if (diag.file && diag.start !== undefined) {
			const startLoc = diag.file.getLineAndCharacterOfPosition(diag.start);
			const endLoc = diag.file.getLineAndCharacterOfPosition(
				diag.start + length,
			);
			line = startLoc.line + 1;
			column = startLoc.character + 1;
			endLine = endLoc.line + 1;
			endColumn = endLoc.character + 1;

			preview = this.generateCaretSnippet(
				diag.file,
				startLoc.line,
				startLoc.character,
				length,
			);
		}

		let relatedInformation: DiagnosticRelatedInformation[] | undefined;
		if (diag.relatedInformation && diag.relatedInformation.length > 0) {
			relatedInformation = diag.relatedInformation.map((info) => {
				let rLine = 1;
				let rCol = 1;
				const rPath = info.file ? this.toRelativePath(info.file.fileName) : "";
				if (info.file && info.start !== undefined) {
					const loc = info.file.getLineAndCharacterOfPosition(info.start);
					rLine = loc.line + 1;
					rCol = loc.character + 1;
				}
				return {
					filePath: rPath,
					line: rLine,
					column: rCol,
					message: ts.flattenDiagnosticMessageText(info.messageText, "\n"),
				};
			});
		}

		return {
			filePath,
			category: this.mapCategory(diag.category),
			code: diag.code,
			message: ts.flattenDiagnosticMessageText(diag.messageText, "\n"),
			line,
			column,
			length,
			endLine,
			endColumn,
			source: "typescript",
			preview,
			sourceSnippet: preview,
			relatedInformation,
		};
	}

	private generateCaretSnippet(
		file: ts.SourceFile,
		lineIndex: number,
		characterOffset: number,
		length: number,
	): string {
		const lines = file.text.split(/\r?\n/);
		const sourceLine = lines[lineIndex] ?? "";
		const colOffset = Math.max(0, characterOffset);
		const spanLen = Math.max(
			1,
			Math.min(length, Math.max(1, sourceLine.length - colOffset)),
		);
		const caretLine = " ".repeat(colOffset) + "^".repeat(spanLen);

		const lineGutter = String(lineIndex + 1).padStart(4, " ");
		const gutterPadding = " ".repeat(lineGutter.length);

		return `${lineGutter} | ${sourceLine}\n${gutterPadding} | ${caretLine}`;
	}

	private extractContextSnippet(
		file: ts.SourceFile,
		centerLineIndex: number,
		padding = 1,
	): string {
		const lines = file.text.split(/\r?\n/);
		const start = Math.max(0, centerLineIndex - padding);
		const end = Math.min(lines.length - 1, centerLineIndex + padding);

		const resultLines: string[] = [];
		for (let i = start; i <= end; i++) {
			const lineGutter = String(i + 1).padStart(4, " ");
			resultLines.push(`${lineGutter} | ${lines[i]}`);
		}
		return resultLines.join("\n");
	}

	private mapCategory(cat: ts.DiagnosticCategory): DiagnosticCategory {
		switch (cat) {
			case ts.DiagnosticCategory.Error:
				return "error";
			case ts.DiagnosticCategory.Warning:
				return "warning";
			case ts.DiagnosticCategory.Suggestion:
				return "suggestion";
			case ts.DiagnosticCategory.Message:
				return "message";
			default:
				return "error";
		}
	}

	private filterDiagnostic(
		item: DiagnosticItem,
		options: LSPDiagnosticsOptions,
	): boolean {
		if (item.category === "warning" && options.includeWarnings === false) {
			return false;
		}
		if (
			item.category === "suggestion" &&
			options.includeSuggestions !== true
		) {
			return false;
		}
		return true;
	}

	private isNonSymbolToken(
		sourceFile: ts.SourceFile,
		position: number,
	): boolean {
		function findToken(node: ts.Node): ts.Node | undefined {
			if (
				position < node.getStart(sourceFile) ||
				position >= node.getEnd()
			) {
				return undefined;
			}
			const children = node.getChildren(sourceFile);
			for (const child of children) {
				const found = findToken(child);
				if (found) return found;
			}
			return node;
		}

		const token = findToken(sourceFile);
		if (token) {
			const isKeyword =
				token.kind >= ts.SyntaxKind.FirstKeyword &&
				token.kind <= ts.SyntaxKind.LastKeyword &&
				token.kind !== ts.SyntaxKind.Identifier;
			const isPunctuation =
				token.kind >= ts.SyntaxKind.FirstPunctuation &&
				token.kind <= ts.SyntaxKind.LastPunctuation;
			if (isKeyword || isPunctuation) {
				return true;
			}
		}
		return false;
	}

	private normalizeFilePath(filePath: string): string {
		return normalizeFilePath(filePath, this.projectRoot);
	}

	private toRelativePath(absoluteOrRelative: string): string {
		const norm = this.normalizeFilePath(absoluteOrRelative);
		const normRoot = this.normalizeFilePath(this.projectRoot);
		if (norm.startsWith(normRoot)) {
			const rel = norm.slice(normRoot.length);
			return rel.startsWith("/") ? rel.slice(1) : rel;
		}
		return norm;
	}
}
