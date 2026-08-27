export interface ScanResult {
	hasInjection: boolean;
	riskLevel: "low" | "medium" | "high";
	matches: string[];
	sanitizedText: string;
}

export class InjectionScanner {
	private injectionPatterns: { pattern: RegExp; risk: "low" | "medium" | "high"; label: string }[] = [
		{
			pattern: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions|prompts|system\s+messages)/i,
			risk: "high",
			label: "System Prompt Override Attack",
		},
		{
			pattern: /\[system\s*message\]|\[system\s*prompt\]|<system_message>|<system>/i,
			risk: "high",
			label: "Role Spoofing Attack",
		},
		{
			pattern: /you\s+are\s+now\s+(?:a|an)\s+(?:unrestricted|DAN|jailbroken|evil|unfiltered)/i,
			risk: "high",
			label: "Jailbreak Persona Attack",
		},
		{
			pattern: /output\s+the\s+following\s+secret|reveal\s+api\s+keys|print\s+env\s+vars/i,
			risk: "medium",
			label: "Data Exfiltration Attack",
		},
		{
			pattern: /[\u200B-\u200D\uFEFF]/,
			risk: "medium",
			label: "Zero-Width Hidden Character Attack",
		},
	];

	/** Scan text for potential prompt injection attacks */
	public scan(text: string): ScanResult {
		if (!text) {
			return { hasInjection: false, riskLevel: "low", matches: [], sanitizedText: "" };
		}

		const matches: string[] = [];
		let maxRisk: "low" | "medium" | "high" = "low";

		for (const { pattern, risk, label } of this.injectionPatterns) {
			if (pattern.test(text)) {
				matches.push(label);
				if (risk === "high" || (risk === "medium" && maxRisk !== "high")) {
					maxRisk = risk;
				}
			}
		}

		const sanitizedText = this.sanitize(text);

		return {
			hasInjection: matches.length > 0,
			riskLevel: maxRisk,
			matches,
			sanitizedText,
		};
	}

	/** Sanitize text by neutralizing hidden payloads and injection tags */
	public sanitize(text: string): string {
		if (!text) return "";

		let clean = text
			// Strip zero-width hidden characters used for steganography
			.replace(/[\u200B-\u200D\uFEFF]/g, "")
			// Neutralize system tag spoofing
			.replace(/<(system_message|system)>/gi, "&lt;$1&gt;")
			.replace(/<\/(system_message|system)>/gi, "&lt;/$1&gt;")
			// Neutralize HTML comment hidden instructions
			.replace(/<!--[\s\S]*?-->/g, "");

		return clean;
	}
}

export const globalInjectionScanner = new InjectionScanner();
