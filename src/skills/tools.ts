import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { Tool, ToolRegistry } from "../tools/registry.ts";
import type { SkillRegistry } from "./registry.ts";

/**
 * Registers skill management and execution tools into the tool registry.
 */
export function registerSkillTools(toolRegistry: ToolRegistry, skillRegistry: SkillRegistry): void {
	// 1. activate_skill
	toolRegistry.register({
		name: "activate_skill",
		description: "Activate a portable skill by name to load its instructions into project context.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Name of the skill to activate" }
			},
			required: ["name"]
		},
		async execute(input) {
			const skillName = String(input.name || input.skill_name || input.skill || "");
			if (!skillName) {
				return { result: "Error: skill name is required", isError: true };
			}
			try {
				const manifest = await skillRegistry.activate(skillName);
				return {
					result: `Skill "${skillName}" activated successfully. Instructions loaded into context.`,
					isError: false
				};
			} catch (err: any) {
				return { result: `Error activating skill "${skillName}": ${err.message}`, isError: true };
			}
		}
	});

	// 2. deactivate_skill
	toolRegistry.register({
		name: "deactivate_skill",
		description: "Deactivate a skill to unload its instructions from context.",
		inputSchema: {
			type: "object",
			properties: {
				name: { type: "string", description: "Name of the skill to deactivate" }
			},
			required: ["name"]
		},
		async execute(input) {
			const skillName = String(input.name || input.skill_name || input.skill || "");
			if (!skillName) {
				return { result: "Error: skill name is required", isError: true };
			}
			const deactivated = skillRegistry.deactivate(skillName);
			if (deactivated) {
				return { result: `Skill "${skillName}" deactivated successfully.`, isError: false };
			}
			return { result: `Skill "${skillName}" was not active.`, isError: false };
		}
	});

	// 3. read_skill_reference
	toolRegistry.register({
		name: "read_skill_reference",
		description: "Read documentation or reference material from a skill's references/ directory.",
		inputSchema: {
			type: "object",
			properties: {
				skill_name: { type: "string", description: "Name of the skill" },
				reference_path: { type: "string", description: "Relative path inside references/" }
			},
			required: ["skill_name", "reference_path"]
		},
		async execute(input) {
			const skillName = String(input.skill_name || input.skill || input.name || "");
			const refPath = String(input.reference_path || input.path || input.reference || "");
			if (!skillName || !refPath) {
				return { result: "Error: skill_name and reference_path are required", isError: true };
			}

			const normalized = path.normalize(refPath).replace(/\\/g, "/");
			if (normalized.startsWith("..") || path.isAbsolute(refPath)) {
				return { result: `Error: path traversal outside references/ is not allowed`, isError: true };
			}

			try {
				const subPath = normalized.startsWith("references/") ? normalized : path.join("references", normalized);
				const fullPath = await skillRegistry.resolveAssetPath(skillName, subPath);
				const content = await fs.readFile(fullPath, "utf-8");
				return { result: content, isError: false };
			} catch (err: any) {
				return { result: `Error reading reference "${refPath}" for skill "${skillName}": ${err.message}`, isError: true };
			}
		}
	});

	// 4. run_skill_script
	toolRegistry.register({
		name: "run_skill_script",
		description: "Execute a helper script located in a skill's scripts/ directory.",
		inputSchema: {
			type: "object",
			properties: {
				skill_name: { type: "string", description: "Name of the skill" },
				script_path: { type: "string", description: "Relative path inside scripts/" },
				args: { type: "array", items: { type: "string" }, description: "Arguments for the script" }
			},
			required: ["skill_name", "script_path"]
		},
		async execute(input) {
			const skillName = String(input.skill_name || input.skill || input.name || "");
			const scriptPath = String(input.script_path || input.path || input.script || "");
			const args: string[] = Array.isArray(input.args) ? input.args.map(String) : [];

			if (!skillName || !scriptPath) {
				return { result: "Error: skill_name and script_path are required", isError: true };
			}

			try {
				const subPath = scriptPath.startsWith("scripts/") ? scriptPath : path.join("scripts", scriptPath);
				const fullPath = await skillRegistry.resolveAssetPath(skillName, subPath);

				const bunExecutable = process.platform === "win32"
					? path.join(process.env.USERPROFILE || "C:\\Users\\DavyJ", ".bun", "bin", "bun.exe")
					: "bun";

				return new Promise((resolve) => {
					let runner = bunExecutable;
					let runnerArgs = [fullPath, ...args];

					if (fullPath.endsWith(".sh")) {
						runner = "bash";
						runnerArgs = [fullPath, ...args];
					} else if (fullPath.endsWith(".py")) {
						runner = "python";
						runnerArgs = [fullPath, ...args];
					}

					const child = spawn(runner, runnerArgs, {
						cwd: path.dirname(fullPath),
						env: { ...process.env },
						shell: process.platform === "win32" && fullPath.endsWith(".sh")
					});

					let stdout = "";
					let stderr = "";

					child.stdout?.on("data", (data) => {
						stdout += data.toString();
					});
					child.stderr?.on("data", (data) => {
						stderr += data.toString();
					});

					child.on("close", (code) => {
						if (code !== 0 && !stdout) {
							resolve({
								result: `Script exited with code ${code}.\nStderr: ${stderr}`,
								isError: true
							});
						} else {
							resolve({
								result: stdout || stderr || `Script completed with exit code ${code}`,
								isError: false
							});
						}
					});

					child.on("error", (err) => {
						resolve({
							result: `Failed to execute script: ${err.message}`,
							isError: true
						});
					});
				});
			} catch (err: any) {
				return { result: `Error executing script "${scriptPath}" for skill "${skillName}": ${err.message}`, isError: true };
			}
		}
	});
}
