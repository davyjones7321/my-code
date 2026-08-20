import type { Harness } from "../sdk/harness.ts";
import type { HarnessSession } from "../sdk/session.ts";
import { validateAuthToken } from "./auth.ts";
import type {
	CreateSessionRequest,
	CreateSessionResponse,
	GatewayConfig,
	PostMessageRequest,
	SessionSummary,
} from "./types.ts";

export interface GatewaySessionRecord {
	sessionId: string;
	session: HarnessSession;
	createdAt: string;
	updatedAt: string;
	activeSSEControllers: Set<ReadableStreamDefaultController>;
}

export class GatewayRoutes {
	private sessions: Map<string, GatewaySessionRecord> = new Map();

	constructor(
		private harness: Harness,
		private config: GatewayConfig,
	) {}

	public getSessionsMap(): Map<string, GatewaySessionRecord> {
		return this.sessions;
	}

	public async handleRequest(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const method = req.method.toUpperCase();
		const pathname = url.pathname;

		// CORS Preflight
		if (method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: this.getCORSHeaders(),
			});
		}

		// Public Health Endpoint (No auth required)
		if (pathname === "/health" && method === "GET") {
			return this.jsonResponse({
				status: "ok",
				gateway: "my-harness-gateway",
				version: "0.1.0",
				uptime: process.uptime(),
				activeSessionsCount: this.sessions.size,
			});
		}

		// Auth Validation for all /api/v1/ endpoints
		const authCheck = validateAuthToken(req, this.config.authToken);
		if (!authCheck.valid) {
			return this.jsonResponse(
				{ error: authCheck.reason || "Unauthorized" },
				401,
			);
		}

		try {
			// GET /api/v1/providers
			if (pathname === "/api/v1/providers" && method === "GET") {
				const providers = this.harness.listProviders();
				return this.jsonResponse({ providers });
			}

			// GET /api/v1/tools
			if (pathname === "/api/v1/tools" && method === "GET") {
				const tools = this.harness.listTools();
				return this.jsonResponse({ tools });
			}

			// POST /api/v1/sessions — Create Session
			if (pathname === "/api/v1/sessions" && method === "POST") {
				const body = (await req.json().catch(() => ({}))) as CreateSessionRequest;
				const session = this.harness.createSession({
					sessionName: body.sessionName,
					mode: body.mode || this.config.mode,
					approvalMode: body.approvalMode || this.config.approvalMode,
				});

				if (body.provider || body.model) {
					session.setProvider(
						body.provider || this.config.defaultProvider || "default",
						body.model,
					);
				}

				const now = new Date().toISOString();
				const record: GatewaySessionRecord = {
					sessionId: session.id,
					session,
					createdAt: now,
					updatedAt: now,
					activeSSEControllers: new Set(),
				};
				this.sessions.set(session.id, record);

				const responsePayload: CreateSessionResponse = {
					sessionId: session.id,
					sessionName: body.sessionName,
					state: session.getState(),
				};
				return this.jsonResponse(responsePayload, 201);
			}

			// GET /api/v1/sessions — List Sessions
			if (pathname === "/api/v1/sessions" && method === "GET") {
				const list: SessionSummary[] = Array.from(this.sessions.values()).map(
					(rec) => ({
						sessionId: rec.sessionId,
						createdAt: rec.createdAt,
						updatedAt: rec.updatedAt,
						state: rec.session.getState(),
					}),
				);
				return this.jsonResponse({ sessions: list });
			}

			// Routes with /api/v1/sessions/:id
			const sessionMatch = pathname.match(/^\/api\/v1\/sessions\/([^/]+)(\/(.*))?$/);
			if (sessionMatch) {
				const sessionId = sessionMatch[1];
				const subPath = sessionMatch[3] || "";

				const record = this.sessions.get(sessionId);
				if (!record) {
					return this.jsonResponse({ error: `Session "${sessionId}" not found.` }, 404);
				}

				// GET /api/v1/sessions/:id — Detail
				if (subPath === "" && method === "GET") {
					return this.jsonResponse({
						sessionId: record.sessionId,
						createdAt: record.createdAt,
						updatedAt: record.updatedAt,
						state: record.session.getState(),
						turnsCount: record.session.getTurnCount(),
						messagesCount: record.session.getMessages().length,
					});
				}

				// DELETE /api/v1/sessions/:id — Terminate / Close
				if (subPath === "" && method === "DELETE") {
					record.session.reset();
					this.sessions.delete(sessionId);
					return this.jsonResponse({
						message: `Session "${sessionId}" closed cleanly.`,
					});
				}

				// POST /api/v1/sessions/:id/messages — Execute turn
				if (subPath === "messages" && method === "POST") {
					const body = (await req.json().catch(() => ({}))) as PostMessageRequest;
					if (!body.prompt || typeof body.prompt !== "string" || !body.prompt.trim()) {
						return this.jsonResponse({ error: "Field 'prompt' is required." }, 400);
					}

					record.updatedAt = new Date().toISOString();

					// Non-streaming Promise mode
					const turnResult = await record.session.send(body.prompt.trim());
					return this.jsonResponse({
						sessionId: record.sessionId,
						turn: turnResult,
					});
				}

				// GET /api/v1/sessions/:id/stream — SSE Stream
				if (subPath === "stream" && method === "GET") {
					return this.handleSSEStream(req, record);
				}
			}

			return this.jsonResponse({ error: "Endpoint not found" }, 404);
		} catch (err: any) {
			return this.jsonResponse({ error: err.message || "Internal server error" }, 500);
		}
	}

	/**
	 * Handles Server-Sent Events (SSE) streaming for a session
	 */
	private handleSSEStream(req: Request, record: GatewaySessionRecord): Response {
		const url = new URL(req.url);
		const promptParam = url.searchParams.get("prompt");

		const stream = new ReadableStream({
			async start(controller) {
				record.activeSSEControllers.add(controller);

				const sendSSE = (eventName: string, data: unknown) => {
					const text = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
					try {
						controller.enqueue(new TextEncoder().encode(text));
					} catch {
						// Stream closed by client
					}
				};

				// If prompt provided in query param, execute turn and stream events
				if (promptParam && promptParam.trim()) {
					try {
						for await (const event of record.session.sendStream(promptParam.trim())) {
							sendSSE("agent_event", event);
						}
					} catch (err: any) {
						sendSSE("error", { message: err.message });
					}
				} else {
					// Standby connection ping
					sendSSE("connected", {
						sessionId: record.sessionId,
						message: "SSE connection established.",
					});
				}
			},
			cancel() {
				// Cleaned up via controller removal
			},
		});

		return new Response(stream, {
			headers: {
				...this.getCORSHeaders(),
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	}

	private getCORSHeaders(): Record<string, string> {
		return {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		};
	}

	private jsonResponse(data: unknown, status = 200): Response {
		return new Response(JSON.stringify(data, null, 2), {
			status,
			headers: {
				...this.getCORSHeaders(),
				"Content-Type": "application/json",
			},
		});
	}
}
