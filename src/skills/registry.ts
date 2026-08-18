import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillManifest, resolveSkillAsset } from "./loader";
import { parseSkillMarkdown } from "./parser";
import type { SkillIndexEntry, SkillManifest } from "./types";

export interface SkillRegistryOptions {
	projectRoot?: string;
	globalRoot?: string;
	customDirs?: string[];
}

interface ScanLocation {
	dir: string;
	scope: "project" | "global";
}

/**
 * SkillRegistry provides progressive discovery, multi-scope indexing,
 * deterministic scope precedence shadowing, and dynamic activation/deactivation.
 */
export class SkillRegistry {
	private static activeRegistries: Map<string, SkillRegistry> = new Map();

	static getActiveForProject(projectRoot: string): SkillRegistry | undefined {
		return SkillRegistry.activeRegistries.get(path.resolve(projectRoot));
	}

	private projectRoot: string;
	private globalRoot: string;
	private customDirs: string[];
	private index: SkillIndexEntry[] = [];
	private manifestCache: Map<string, SkillManifest> = new Map();
	private activeSkills: Map<string, SkillManifest> = new Map();

	constructor(options?: SkillRegistryOptions) {
		this.projectRoot = options?.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
		this.globalRoot = options?.globalRoot
			? path.resolve(options.globalRoot)
			: path.resolve(process.env.USERPROFILE || process.env.HOME || os.homedir());
		this.customDirs = options?.customDirs ? options.customDirs.map((d) => path.resolve(d)) : [];

		SkillRegistry.activeRegistries.set(this.projectRoot, this);
	}

	/**
	 * Scans all skill search directories in deterministic precedence order:
	 * 1. Custom directories (if configured)
	 * 2. Project harness skills (<projectRoot>/.harness/skills)
	 * 3. Project root skills (<projectRoot>/skills)
	 * 4. Global harness skills (<globalRoot>/.harness/skills)
	 * 5. Global root skills (<globalRoot>/skills)
	 *
	 * Extracts lightweight name + description metadata into memory index (~20-40 tokens per skill)
	 * without loading full instruction bodies into memory.
	 */
	async discover(): Promise<SkillIndexEntry[]> {
		const searchLocations: ScanLocation[] = [];

		// 1. Custom directories (highest priority)
		for (const customDir of this.customDirs) {
			searchLocations.push({ dir: customDir, scope: "project" });
		}

		// 2. Project .harness/skills (precedence level 1)
		searchLocations.push({
			dir: path.join(this.projectRoot, ".harness", "skills"),
			scope: "project",
		});

		// 3. Project skills/ (precedence level 2)
		searchLocations.push({
			dir: path.join(this.projectRoot, "skills"),
			scope: "project",
		});

		// 4. Global .harness/skills (precedence level 3a)
		searchLocations.push({
			dir: path.join(this.globalRoot, ".harness", "skills"),
			scope: "global",
		});

		// 5. Global skills/ (precedence level 3b)
		searchLocations.push({
			dir: path.join(this.globalRoot, "skills"),
			scope: "global",
		});

		const seenNames = new Set<string>();
		const discovered: SkillIndexEntry[] = [];
		const scannedDirs = new Set<string>();

		for (const loc of searchLocations) {
			const resolvedDir = path.resolve(loc.dir);
			if (scannedDirs.has(resolvedDir)) {
				continue;
			}
			scannedDirs.add(resolvedDir);

			try {
				const stat = await fsPromises.stat(resolvedDir);
				if (!stat.isDirectory()) {
					continue;
				}
			} catch {
				// Directory does not exist on disk, skip cleanly
				continue;
			}

			let entries: import("node:fs").Dirent[] = [];
			try {
				entries = await fsPromises.readdir(resolvedDir, { withFileTypes: true });
			} catch {
				continue;
			}

			// Sort entries alphabetically for deterministic discovery order
			entries.sort((a, b) => a.name.localeCompare(b.name));

			for (const entry of entries) {
				if (!entry.isDirectory() || entry.name.startsWith(".")) {
					continue;
				}

				const candidateDir = path.join(resolvedDir, entry.name);
				const skillMdPath = path.join(candidateDir, "SKILL.md");

				try {
					const mdStat = await fsPromises.stat(skillMdPath);
					if (!mdStat.isFile()) {
						continue;
					}

					const rawContent = await fsPromises.readFile(skillMdPath, "utf-8");
					const parseResult = parseSkillMarkdown(rawContent, candidateDir, loc.scope);

					if (!parseResult.valid || !parseResult.manifest) {
						// Malformed skill folder ignored during discovery without crashing
						continue;
					}

					const skillName = parseResult.manifest.frontmatter.name;
					if (seenNames.has(skillName)) {
						// Shadowed by higher precedence skill directory
						continue;
					}

					seenNames.add(skillName);
					discovered.push({
						name: skillName,
						description: parseResult.manifest.frontmatter.description,
						scope: loc.scope,
						skillDir: path.resolve(candidateDir),
						triggers: parseResult.manifest.frontmatter.triggers,
						version: parseResult.manifest.frontmatter.version,
					});
				} catch {
					// Corrupted or unreadable file, ignore gracefully
				}
			}
		}

		this.index = discovered;
		return [...this.index];
	}

	/**
	 * Returns the discovered skill index entries.
	 */
	getSkillIndex(): SkillIndexEntry[] {
		return [...this.index];
	}

	/**
	 * Formats discovered skills into a concise, token-efficient discovery prompt index.
	 */
	formatDiscoveryPrompt(): string {
		if (this.index.length === 0) {
			return "";
		}

		const lines = [
			"Available skills:",
			...this.index.map((entry) => {
				const triggers =
					entry.triggers && entry.triggers.length > 0
						? ` (Triggers: ${entry.triggers.join(", ")})`
						: "";
				return `- ${entry.name}: ${entry.description}${triggers}`;
			}),
		];

		return lines.join("\n");
	}

	/**
	 * Retrieves the full SkillManifest for a skill on demand, caching it for subsequent calls.
	 */
	async getSkill(name: string): Promise<SkillManifest | undefined> {
		const entry = this.index.find((s) => s.name === name);
		if (!entry) {
			return undefined;
		}

		const cached = this.manifestCache.get(name);
		if (cached && cached.skillDir === entry.skillDir) {
			return cached;
		}

		try {
			const manifest = await loadSkillManifest(entry.skillDir, entry.scope);
			this.manifestCache.set(name, manifest);
			return manifest;
		} catch {
			return undefined;
		}
	}

	/**
	 * Dynamically loads and activates a skill by name into Tier 2 Context.
	 * Idempotent: activating an already active skill returns the existing active manifest.
	 */
	async activate(name: string): Promise<SkillManifest> {
		const entry = this.index.find((s) => s.name === name);
		if (!entry) {
			throw new Error(`Skill "${name}" not found in registry. Ensure discover() has been called.`);
		}

		const active = this.activeSkills.get(name);
		if (active) {
			return active;
		}

		const manifest = await this.getSkill(name);
		if (!manifest) {
			throw new Error(`Failed to load manifest for skill "${name}" from ${entry.skillDir}`);
		}

		this.activeSkills.set(name, manifest);
		return manifest;
	}

	/**
	 * Deactivates a skill by name, removing it from the active set.
	 * Returns true if the skill was active, false otherwise.
	 */
	deactivate(name: string): boolean {
		if (this.activeSkills.has(name)) {
			this.activeSkills.delete(name);
			return true;
		}
		return false;
	}

	/**
	 * Returns all currently active skill manifests.
	 */
	getActiveSkills(): SkillManifest[] {
		return Array.from(this.activeSkills.values());
	}

	/**
	 * Resolves an asset, script, or reference subpath within a skill package,
	 * strictly enforcing sandbox boundaries against path traversal.
	 */
	async resolveAssetPath(skillName: string, subPath: string): Promise<string> {
		const entry = this.index.find((s) => s.name === skillName);
		if (!entry) {
			throw new Error(`Skill "${skillName}" not found in registry`);
		}

		return resolveSkillAsset(entry.skillDir, subPath);
	}
}
