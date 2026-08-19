import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { FileEntry, LSPHostConfig } from "./types.ts";

export const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	strict: true,
	noImplicitAny: false,
	esModuleInterop: true,
	skipLibCheck: true,
	allowJs: true,
	checkJs: false,
	declaration: true,
	noEmit: true,
	resolveJsonModule: true,
	isolatedModules: true,
	forceConsistentCasingInFileNames: true,
	allowSyntheticDefaultImports: true,
};

/** Normalize file paths to POSIX forward-slash format */
export function normalizeFilePath(
	filePath: string,
	basePath?: string,
): string {
	if (!filePath) return "";
	const resolved = path.isAbsolute(filePath)
		? path.normalize(filePath)
		: path.resolve(basePath || process.cwd(), filePath);
	return resolved.replace(/\\/g, "/");
}

/** Fallback minimal lib declaration if standard library is unavailable */
const MINIMAL_DEFAULT_LIB = `
declare var NaN: number;
declare var Infinity: number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;
declare function parseFloat(string: string): number;
declare function parseInt(s: string, radix?: number): number;
declare function encodeURI(uri: string): string;
declare function decodeURI(encodedURI: string): string;
interface Object { constructor: Function; toString(): string; toLocaleString(): string; valueOf(): Object; hasOwnProperty(v: PropertyKey): boolean; isPrototypeOf(v: Object): boolean; propertyIsEnumerable(v: PropertyKey): boolean; }
interface Function { apply(this: Function, thisArg: any, argArray?: any): any; call(this: Function, thisArg: any, ...argArray: any[]): any; bind(this: Function, thisArg: any, ...argArray: any[]): any; readonly length: number; readonly name: string; }
interface String { readonly length: number; charAt(pos: number): string; charCodeAt(index: number): number; concat(...strings: string[]): string; indexOf(searchString: string, position?: number): number; lastIndexOf(searchString: string, position?: number): number; slice(start?: number, end?: number): string; substring(start: number, end?: number): string; toLowerCase(): string; toUpperCase(): string; trim(): string; replace(searchValue: string | RegExp, replaceValue: string): string; split(separator: string | RegExp, limit?: number): string[]; }
interface Boolean { valueOf(): boolean; }
interface Number { toFixed(fractionDigits?: number): string; toExponential(fractionDigits?: number): string; toPrecision(precision?: number): string; toString(radix?: number): string; valueOf(): number; }
interface Array<T> { readonly length: number; [n: number]: T; push(...items: T[]): number; pop(): T | undefined; shift(): T | undefined; unshift(...items: T[]): number; slice(start?: number, end?: number): T[]; splice(start: number, deleteCount?: number, ...items: T[]): T[]; forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void; map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[]; filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[]; filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): T[]; find(predicate: (value: T, index: number, obj: T[]) => boolean, thisArg?: any): T | undefined; includes(searchElement: T, fromIndex?: number): boolean; indexOf(searchElement: T, fromIndex?: number): number; join(separator?: string): string; }
interface Promise<T> { then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2>; catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult>; finally(onfinally?: (() => void) | undefined | null): Promise<T>; }
interface PromiseConstructor { readonly prototype: Promise<any>; new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>; all<T>(values: Iterable<T | PromiseLike<T>>): Promise<T[]>; resolve<T>(value: T | PromiseLike<T>): Promise<T>; reject<T = never>(reason?: any): Promise<T>; }
declare var Promise: PromiseConstructor;
interface Map<K, V> { clear(): void; delete(key: K): boolean; forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void; get(key: K): V | undefined; has(key: K): boolean; set(key: K, value: V): this; readonly size: number; }
interface Set<T> { add(value: T): this; clear(): void; delete(value: T): boolean; forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void; has(value: T): boolean; readonly size: number; }
interface Symbol { readonly description: string | undefined; }
type Record<K extends keyof any, T> = { [P in K]: T; };
type Partial<T> = { [P in keyof T]?: T[P]; };
type Required<T> = { [P in keyof T]-?: T[P]; };
type Readonly<T> = { readonly [P in keyof T]: T[P]; };
type Pick<T, K extends keyof T> = { [P in K]: T[P]; };
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type NonNullable<T> = T extends null | undefined ? never : T;
type PropertyKey = string | number | symbol;
`;

export class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {
	private files: Map<string, FileEntry> = new Map();
	private fileNames: Set<string> = new Set();
	private compilerOptions: ts.CompilerOptions;
	private projectRoot: string;
	private useDiskFallback: boolean;
	private languageService: ts.LanguageService;

	constructor(options: LSPHostConfig = {}) {
		this.projectRoot = normalizeFilePath(options.projectRoot || process.cwd());
		this.useDiskFallback = options.useDiskFallback ?? true;

		// Initialize compiler options from tsconfig or defaults
		this.compilerOptions = this.initCompilerOptions(options);

		// Populate initial files if provided
		if (options.files) {
			for (const [filePath, content] of Object.entries(options.files)) {
				this.addOrUpdateFile(filePath, content);
			}
		}

		// Create LanguageService instance
		this.languageService = ts.createLanguageService(
			this,
			ts.createDocumentRegistry(),
		);
	}

	private initCompilerOptions(options: LSPHostConfig): ts.CompilerOptions {
		let opts: ts.CompilerOptions = {
			...DEFAULT_COMPILER_OPTIONS,
			...options.compilerOptions,
		};

		const tsConfigPath =
			options.tsConfigPath ||
			(this.useDiskFallback
				? ts.findConfigFile(
						this.projectRoot,
						ts.sys.fileExists,
						"tsconfig.json",
					)
				: undefined);

		if (tsConfigPath && fs.existsSync(tsConfigPath)) {
			try {
				const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
				if (!configFile.error) {
					const parsed = ts.parseJsonConfigFileContent(
						configFile.config,
						ts.sys,
						path.dirname(tsConfigPath),
						undefined,
						tsConfigPath,
					);
					opts = { ...opts, ...parsed.options };
					for (const f of parsed.fileNames) {
						const norm = normalizeFilePath(f);
						this.fileNames.add(norm);
					}
				}
			} catch {
				// Fallback to default options if tsconfig parsing fails
			}
		}

		return opts;
	}

	public resolvePath(filePath: string): string {
		return normalizeFilePath(filePath, this.projectRoot);
	}

	// --- File Mutation & Access Methods ---

	public addOrUpdateFile(filePath: string, content?: string): void {
		const norm = this.resolvePath(filePath);
		const existing = this.files.get(norm);

		let fileContent = content;
		if (fileContent === undefined) {
			if (existing) {
				return; // No content passed and already tracked
			}
			const resolvedPath = path.isAbsolute(filePath)
				? filePath
				: path.resolve(this.projectRoot, filePath);
			if (this.useDiskFallback && fs.existsSync(resolvedPath)) {
				try {
					fileContent = fs.readFileSync(resolvedPath, "utf-8");
				} catch {
					fileContent = "";
				}
			} else {
				fileContent = "";
			}
		}

		if (existing) {
			if (existing.content === fileContent) {
				return; // Content unchanged, keep existing snapshot and version
			}
			existing.version += 1;
			existing.content = fileContent;
			existing.snapshot = ts.ScriptSnapshot.fromString(fileContent);
		} else {
			const entry: FileEntry = {
				fileName: norm,
				content: fileContent,
				version: 1,
				snapshot: ts.ScriptSnapshot.fromString(fileContent),
				onDisk: false,
			};
			this.files.set(norm, entry);
			this.fileNames.add(norm);
		}
	}

	public addFile(filePath: string, content: string): void {
		this.addOrUpdateFile(filePath, content);
	}

	public updateFile(filePath: string, content: string): void {
		this.addOrUpdateFile(filePath, content);
	}

	public deleteFile(filePath: string): boolean {
		const norm = this.resolvePath(filePath);
		this.fileNames.delete(norm);
		return this.files.delete(norm);
	}

	public removeFile(filePath: string): boolean {
		return this.deleteFile(filePath);
	}

	public hasFile(filePath: string): boolean {
		const norm = this.resolvePath(filePath);
		if (this.files.has(norm)) {
			return true;
		}
		const resolvedPath = path.isAbsolute(filePath)
			? filePath
			: path.resolve(this.projectRoot, filePath);
		return this.useDiskFallback && fs.existsSync(resolvedPath);
	}

	public getFileContent(filePath: string): string | undefined {
		const norm = this.resolvePath(filePath);
		const inMemory = this.files.get(norm);
		if (inMemory) {
			return inMemory.content;
		}
		const resolvedPath = path.isAbsolute(filePath)
			? filePath
			: path.resolve(this.projectRoot, filePath);
		if (this.useDiskFallback && fs.existsSync(resolvedPath)) {
			try {
				return fs.readFileSync(resolvedPath, "utf-8");
			} catch {
				return undefined;
			}
		}
		return undefined;
	}

	public getFileNames(): string[] {
		return Array.from(this.fileNames);
	}

	public getProjectFiles(): string[] {
		return this.getFileNames();
	}

	public setCompilerOptions(options: ts.CompilerOptions): void {
		this.compilerOptions = { ...this.compilerOptions, ...options };
	}

	public syncFromDisk(filePath: string): boolean {
		const resolvedPath = path.isAbsolute(filePath)
			? filePath
			: path.resolve(this.projectRoot, filePath);
		if (!this.useDiskFallback || !fs.existsSync(resolvedPath)) {
			return false;
		}
		try {
			const content = fs.readFileSync(resolvedPath, "utf-8");
			this.addOrUpdateFile(filePath, content);
			return true;
		} catch {
			return false;
		}
	}

	public getLanguageService(): ts.LanguageService {
		return this.languageService;
	}

	public dispose(): void {
		this.languageService.dispose();
	}

	// --- ts.LanguageServiceHost Implementation ---

	public getCompilationSettings(): ts.CompilerOptions {
		return this.compilerOptions;
	}

	public getScriptFileNames(): string[] {
		return Array.from(this.fileNames);
	}

	public getScriptVersion(fileName: string): string {
		const norm = this.resolvePath(fileName);
		const entry = this.files.get(norm);
		return entry ? entry.version.toString() : "0";
	}

	public getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
		const norm = this.resolvePath(fileName);
		const inMemory = this.files.get(norm);
		if (inMemory) {
			return inMemory.snapshot;
		}

		const resolvedPath = path.isAbsolute(fileName)
			? fileName
			: path.resolve(this.projectRoot, fileName);
		if (this.useDiskFallback && fs.existsSync(resolvedPath)) {
			try {
				const content = fs.readFileSync(resolvedPath, "utf-8");
				const entry: FileEntry = {
					fileName: norm,
					content,
					version: 1,
					snapshot: ts.ScriptSnapshot.fromString(content),
					onDisk: true,
				};
				this.files.set(norm, entry);
				this.fileNames.add(norm);
				return entry.snapshot;
			} catch {
				return undefined;
			}
		}

		// Fallback for default lib file if not found on disk
		if (fileName.includes("lib.d.ts") || fileName.includes("lib.es")) {
			return ts.ScriptSnapshot.fromString(MINIMAL_DEFAULT_LIB);
		}

		return undefined;
	}

	public getCurrentDirectory(): string {
		return this.projectRoot;
	}

	public getDefaultLibFileName(options: ts.CompilerOptions): string {
		return ts.getDefaultLibFilePath(options);
	}

	public fileExists(fileName: string): boolean {
		const norm = this.resolvePath(fileName);
		if (this.files.has(norm)) {
			return true;
		}
		const resolvedPath = path.isAbsolute(fileName)
			? fileName
			: path.resolve(this.projectRoot, fileName);
		return this.useDiskFallback && ts.sys.fileExists(resolvedPath);
	}

	public readFile(fileName: string, encoding?: string): string | undefined {
		const norm = this.resolvePath(fileName);
		const inMemory = this.files.get(norm);
		if (inMemory) {
			return inMemory.content;
		}
		const resolvedPath = path.isAbsolute(fileName)
			? fileName
			: path.resolve(this.projectRoot, fileName);
		if (this.useDiskFallback && ts.sys.fileExists(resolvedPath)) {
			return ts.sys.readFile(resolvedPath, encoding);
		}
		if (fileName.includes("lib.d.ts") || fileName.includes("lib.es")) {
			return MINIMAL_DEFAULT_LIB;
		}
		return undefined;
	}

	public readDirectory(
		pathStr: string,
		extensions?: readonly string[],
		exclude?: readonly string[],
		include?: readonly string[],
		depth?: number,
	): string[] {
		const resolvedPath = path.isAbsolute(pathStr)
			? pathStr
			: path.resolve(this.projectRoot, pathStr);
		const diskFiles = this.useDiskFallback
			? ts.sys.readDirectory(resolvedPath, extensions, exclude, include, depth)
			: [];
		const normPath = this.resolvePath(pathStr);
		const memoryFiles = Array.from(this.fileNames).filter((f) =>
			f.startsWith(normPath),
		);
		return Array.from(
			new Set([
				...diskFiles.map((p) => normalizeFilePath(p, this.projectRoot)),
				...memoryFiles,
			]),
		);
	}

	public directoryExists(dirName: string): boolean {
		const resolvedPath = path.isAbsolute(dirName)
			? dirName
			: path.resolve(this.projectRoot, dirName);
		return this.useDiskFallback && ts.sys.directoryExists(resolvedPath);
	}

	public getDirectories(dirName: string): string[] {
		const resolvedPath = path.isAbsolute(dirName)
			? dirName
			: path.resolve(this.projectRoot, dirName);
		return this.useDiskFallback ? ts.sys.getDirectories(resolvedPath) : [];
	}

	public resolveModuleNames(
		moduleNames: string[],
		containingFile: string,
		_reusedNames?: string[],
		_redirectedReference?: ts.ResolvedProjectReference,
		options?: ts.CompilerOptions,
		_containingSourceFile?: ts.SourceFile,
	): (ts.ResolvedModule | undefined)[] {
		const compilerOptions = options ?? this.getCompilationSettings();
		const resolutionHost: ts.ModuleResolutionHost = {
			fileExists: (fileName) => this.fileExists(fileName),
			readFile: (fileName) => this.readFile(fileName),
			directoryExists: (dirName) => this.directoryExists(dirName),
			getCurrentDirectory: () => this.getCurrentDirectory(),
			getDirectories: (dirName) => this.getDirectories(dirName),
			realpath: (p) => (ts.sys.realpath ? ts.sys.realpath(p) : p),
			useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames ?? false,
		};

		return moduleNames.map((moduleName) => {
			const result = ts.resolveModuleName(
				moduleName,
				containingFile,
				compilerOptions,
				resolutionHost,
			);
			if (result.resolvedModule) {
				return result.resolvedModule;
			}
			return this.resolveInMemoryModule(moduleName, containingFile);
		});
	}

	private resolveInMemoryModule(
		moduleName: string,
		containingFile: string,
	): ts.ResolvedModule | undefined {
		if (!moduleName.startsWith(".") && !moduleName.startsWith("/")) {
			return undefined;
		}
		const containingDir = path.dirname(containingFile);
		const targetPath = path.resolve(containingDir, moduleName);
		const candidates = [
			targetPath,
			`${targetPath}.ts`,
			`${targetPath}.tsx`,
			`${targetPath}.d.ts`,
			`${targetPath}.js`,
			`${targetPath}.jsx`,
			path.join(targetPath, "index.ts"),
			path.join(targetPath, "index.tsx"),
			path.join(targetPath, "index.d.ts"),
			path.join(targetPath, "index.js"),
			path.join(targetPath, "index.jsx"),
		];

		for (const candidate of candidates) {
			const norm = normalizeFilePath(candidate);
			if (this.files.has(norm)) {
				return {
					resolvedFileName: norm,
					isExternalLibraryImport: false,
					extension:
						norm.endsWith(".ts") ||
						norm.endsWith(".tsx") ||
						norm.endsWith(".d.ts")
							? ts.Extension.Ts
							: ts.Extension.Js,
				} as ts.ResolvedModuleFull;
			}
		}
		return undefined;
	}
}
