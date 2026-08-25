import { OpenAIProvider } from "./openai.ts";

export class CloudflareProvider extends OpenAIProvider {
	constructor(apiToken: string, accountId: string, baseUrl?: string) {
		const effectiveBaseUrl =
			baseUrl ||
			(accountId
				? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
				: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1");
		super(apiToken, effectiveBaseUrl);
		this.name = "cloudflare";
	}
}
