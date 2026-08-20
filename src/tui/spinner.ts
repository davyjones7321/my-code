import chalk from "chalk";
import type { SpinnerOptions } from "./types.ts";

export const DEFAULT_BRAILLE_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

/**
 * Animated Braille Terminal Spinner
 *
 * Provides smooth terminal animations with safe timer lifecycles (unref),
 * TTY-awareness, non-TTY graceful fallback, and success/failure status formatting.
 */
export class Spinner {
	private text: string;
	private frames: string[];
	private intervalMs: number;
	private stream: NodeJS.WritableStream;
	private isTTY: boolean;
	private timer: NodeJS.Timeout | null = null;
	private frameIndex = 0;
	private spinning = false;

	constructor(options?: SpinnerOptions | string) {
		const opts: SpinnerOptions =
			typeof options === "string" ? { text: options } : options || {};

		this.text = opts.text || "";
		this.frames =
			opts.spinnerFrames && opts.spinnerFrames.length > 0
				? opts.spinnerFrames
				: DEFAULT_BRAILLE_FRAMES;
		this.intervalMs = opts.intervalMs || 80;
		this.stream = opts.stream || process.stderr;
		this.isTTY = opts.isTTY ?? Boolean((this.stream as any)?.isTTY);
	}

	/**
	 * Returns true if the spinner is currently active and animating
	 */
	public isSpinning(): boolean {
		return this.spinning;
	}

	/**
	 * Returns true if the spinner is currently active and animating
	 */
	public isActive(): boolean {
		return this.spinning;
	}

	/**
	 * Gets the current spinner status message
	 */
	public getText(): string {
		return this.text;
	}

	/**
	 * Sets the status message
	 */
	public setText(text: string): this {
		this.text = text;
		if (this.spinning && this.isTTY) {
			this.renderFrame();
		}
		return this;
	}

	/**
	 * Updates the spinner message
	 */
	public update(message: string): this {
		return this.setText(message);
	}

	/**
	 * Starts the spinner animation
	 */
	public start(message?: string): this {
		if (message !== undefined) {
			this.text = message;
		}

		if (this.spinning) {
			return this;
		}

		this.spinning = true;
		this.frameIndex = 0;

		if (this.isTTY) {
			// Hide terminal cursor
			this.stream.write("\x1b[?25l");
			this.renderFrame();

			this.timer = setInterval(() => {
				this.frameIndex = (this.frameIndex + 1) % this.frames.length;
				this.renderFrame();
			}, this.intervalMs);

			// Unref timer so it doesn't keep node/bun event loop open in tests
			if (this.timer && typeof this.timer.unref === "function") {
				this.timer.unref();
			}
		} else {
			// In non-TTY mode, emit initial text if provided
			if (this.text) {
				this.stream.write(`... ${this.text}\n`);
			}
		}

		return this;
	}

	/**
	 * Stops the spinner animation
	 */
	public stop(): this {
		if (!this.spinning) {
			return this;
		}

		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}

		this.spinning = false;

		if (this.isTTY) {
			// Clear line and restore cursor
			this.stream.write("\r\x1b[2K\x1b[?25h");
		}

		return this;
	}

	/**
	 * Stops the spinner and renders a green success checkmark
	 */
	public succeed(message?: string): this {
		const finalMsg = message !== undefined ? message : this.text;
		this.stop();

		const symbol = chalk.green("✔");
		const textPart = finalMsg ? ` ${finalMsg}` : "";
		this.stream.write(`${symbol}${textPart}\n`);

		return this;
	}

	/**
	 * Stops the spinner and renders a red failure symbol
	 */
	public fail(message?: string): this {
		const finalMsg = message !== undefined ? message : this.text;
		this.stop();

		const symbol = chalk.red("✖");
		const textPart = finalMsg ? ` ${finalMsg}` : "";
		this.stream.write(`${symbol}${textPart}\n`);

		return this;
	}

	/**
	 * Renders a single animation frame to the stream
	 */
	private renderFrame(): void {
		if (!this.isTTY) return;
		const frame = chalk.cyan(this.frames[this.frameIndex]);
		const textPart = this.text ? ` ${this.text}` : "";
		this.stream.write(`\r\x1b[2K${frame}${textPart}`);
	}
}

/**
 * Creates and starts a new Spinner
 */
export function createSpinner(options?: SpinnerOptions | string): Spinner {
	const spinner = new Spinner(options);
	return spinner.start();
}
