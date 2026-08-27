import * as fs from "node:fs";
import chalk from "chalk";

export interface FileBackup {
	filePath: string;
	originalContent: string;
	timestamp: number;
}

export class DiffEngine {
	private backups: FileBackup[] = [];

	/** Backup a file before it is modified */
	public backupFile(filePath: string, content: string): void {
		this.backups.push({
			filePath,
			originalContent: content,
			timestamp: Date.now(),
		});
	}

	/** Rollback the last set of file edits */
	public rollbackLast(): { restoredCount: number; restoredFiles: string[] } {
		if (this.backups.length === 0) {
			return { restoredCount: 0, restoredFiles: [] };
		}

		const restoredFiles: string[] = [];
		const lastBackup = this.backups.pop();

		if (lastBackup) {
			try {
				fs.writeFileSync(lastBackup.filePath, lastBackup.originalContent, "utf8");
				restoredFiles.push(lastBackup.filePath);
			} catch {
				// Ignore write errors during restore
			}
		}

		return {
			restoredCount: restoredFiles.length,
			restoredFiles,
		};
	}

	/** Generate unified colorized diff between old and new string content */
	public generateDiff(filePath: string, oldContent: string, newContent: string): string {
		const oldLines = oldContent.split("\n");
		const newLines = newContent.split("\n");

		let diffText = `\n--- a/${filePath}\n+++ b/${filePath}\n`;

		let i = 0;
		let j = 0;

		while (i < oldLines.length || j < newLines.length) {
			if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
				// Line matches
				i++;
				j++;
			} else {
				if (i < oldLines.length) {
					diffText += `${chalk.red(`- ${oldLines[i]}`)}\n`;
					i++;
				}
				if (j < newLines.length) {
					diffText += `${chalk.green(`+ ${newLines[j]}`)}\n`;
					j++;
				}
			}
		}

		return diffText;
	}
}

export const globalDiffEngine = new DiffEngine();
