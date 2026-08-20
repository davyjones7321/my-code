export function validateAuthToken(
	req: Request,
	expectedToken?: string,
): { valid: boolean; reason?: string } {
	if (!expectedToken || expectedToken.trim() === "") {
		return { valid: true };
	}

	const authHeader = req.headers.get("Authorization");
	if (authHeader) {
		const match = authHeader.match(/^Bearer\s+(.+)$/i);
		if (match && match[1] === expectedToken) {
			return { valid: true };
		}
	}

	// Also check query param ?token=
	const url = new URL(req.url);
	const queryToken = url.searchParams.get("token");
	if (queryToken && queryToken === expectedToken) {
		return { valid: true };
	}

	return {
		valid: false,
		reason: "Unauthorized: Invalid or missing Bearer token.",
	};
}
