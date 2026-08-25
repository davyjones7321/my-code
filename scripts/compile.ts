import * as fs from "node:fs";
import path from "node:path";
import { spawn } from "bun";

export interface CompileOptions {
	target?: string;
	outDir?: string;
	all?: boolean;
}

export async function compileBinary(options: CompileOptions = {}): Promise<{ success: boolean; outFiles: string[] }> {
	const projectRoot = process.cwd();
	const outDir = path.resolve(projectRoot, options.outDir || "dist");

	if (!fs.existsSync(outDir)) {
		fs.mkdirSync(outDir, { recursive: true });
	}

	const entryPoint = path.resolve(projectRoot, "src/cli/index.ts");
	const isWindows = process.platform === "win32";

	const targets = options.all
		? ["win-x64", "linux-x64", "darwin-arm64", "darwin-x64"]
		: [options.target || `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`];

	const outFiles: string[] = [];

	for (const tgt of targets) {
		const ext = tgt.startsWith("win") ? ".exe" : "";
		const outFile = path.resolve(outDir, `harness-${tgt}${ext}`);
		const bunTarget = `bun-${tgt}`;

		console.log(`🔨 Compiling standalone binary for target [${tgt}] -> ${outFile}...`);

		const args = [
			"build",
			"--compile",
			`--target=${bunTarget}`,
			entryPoint,
			`--outfile=${outFile}`,
		];

		const proc = spawn([isWindows ? "bun.exe" : "bun", ...args], {
			cwd: projectRoot,
			stdout: "pipe",
			stderr: "pipe",
		});

		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			console.error(`❌ Compilation failed for ${tgt}:\n${stderr || stdout}`);
			return { success: false, outFiles };
		}

		console.log(`✅ Successfully compiled ${outFile}`);
		outFiles.push(outFile);

		// Also create my-code binary aliases
		const myCodeFile = path.resolve(outDir, `my-code-${tgt}${ext}`);
		fs.copyFileSync(outFile, myCodeFile);
		outFiles.push(myCodeFile);

		const genericMyCode = path.resolve(outDir, `my-code${ext}`);
		fs.copyFileSync(outFile, genericMyCode);
		if (!outFiles.includes(genericMyCode)) {
			outFiles.push(genericMyCode);
		}
	}

	return { success: true, outFiles };
}

// CLI execution entrypoint for compilation script
if (import.meta.main) {
	const args = process.argv.slice(2);
	const all = args.includes("--all");
	const targetArg = args.find((a) => a.startsWith("--target="))?.split("=")[1];

	compileBinary({ all, target: targetArg }).then(({ success, outFiles }) => {
		if (!success) {
			process.exit(1);
		}
		console.log(`🎉 Binary compilation complete. Generated ${outFiles.length} file(s).`);
	});
}
