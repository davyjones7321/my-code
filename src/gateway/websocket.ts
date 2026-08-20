import type { ServerWebSocket } from "bun";
import type { HarnessSession } from "../sdk/session.ts";
import type { SDKEvent } from "../sdk/types.ts";
import { validateAuthToken } from "./auth.ts";
import type { GatewaySessionRecord } from "./routes.ts";
import type { GatewayConfig, WSClientMessage, WSServerMessage } from "./types.ts";

export interface WSClientData {
	sessionId?: string;
	authenticated: boolean;
	pendingApprovals: Map<string, (approved: boolean) => void>;
}

export class WebSocketGatewayHandler {
	constructor(
		private getSessionRecord: (sessionId: string) => GatewaySessionRecord | undefined,
		private config: GatewayConfig,
	) {}

	public handleOpen(ws: ServerWebSocket<WSClientData>): void {
		ws.data = {
			authenticated: !this.config.authToken, // If no auth token required, auto-authenticated
			pendingApprovals: new Map(),
		};
	}

	public async handleMessage(
		ws: ServerWebSocket<WSClientData>,
		rawMessage: string | Buffer,
	): Promise<void> {
		try {
			const text = typeof rawMessage === "string" ? rawMessage : rawMessage.toString();
			const msg: WSClientMessage = JSON.parse(text);

			// Check auth if token required
			if (!ws.data.authenticated) {
				const reqMock = new Request(`http://localhost?token=${msg.sessionId || ""}`, {
					headers: { Authorization: `Bearer ${msg.sessionId || ""}` },
				});
				const auth = validateAuthToken(reqMock, this.config.authToken);
				if (!auth.valid) {
					this.sendWS(ws, {
						type: "error",
						error: "Unauthorized WebSocket connection.",
					});
					ws.close(4001, "Unauthorized");
					return;
				}
				ws.data.authenticated = true;
			}

			if (msg.type === "ping") {
				this.sendWS(ws, { type: "pong" });
				return;
			}

			if (msg.type === "approval_response" && msg.requestId) {
				const resolver = ws.data.pendingApprovals.get(msg.requestId);
				if (resolver) {
					resolver(msg.approved === true);
					ws.data.pendingApprovals.delete(msg.requestId);
				}
				return;
			}

			if (msg.type === "prompt") {
				const sessionId = msg.sessionId || ws.data.sessionId;
				if (!sessionId) {
					this.sendWS(ws, {
						type: "error",
						error: "Field 'sessionId' is required to execute prompt.",
					});
					return;
				}

				const record = this.getSessionRecord(sessionId);
				if (!record) {
					this.sendWS(ws, {
						type: "error",
						sessionId,
						error: `Session "${sessionId}" not found.`,
					});
					return;
				}

				ws.data.sessionId = sessionId;
				const session = record.session;

				// Attach WebSocket interactive approval interceptor if required
				session.onApprovalRequest(async (request) => {
					const reqId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
					this.sendWS(ws, {
						type: "approval_request",
						sessionId,
						requestId: reqId,
						toolName: request.toolName,
						toolInput: request.toolInput,
					});

					return new Promise<boolean>((resolve) => {
						// Default timeout resolve false if client drops
						const timer = setTimeout(() => {
							ws.data.pendingApprovals.delete(reqId);
							resolve(false);
						}, 30000);

						ws.data.pendingApprovals.set(reqId, (approved) => {
							clearTimeout(timer);
							resolve(approved);
						});
					});
				});

				if (!msg.prompt || !msg.prompt.trim()) {
					this.sendWS(ws, {
						type: "error",
						sessionId,
						error: "Prompt cannot be empty.",
					});
					return;
				}

				// Execute and stream events over WebSocket
				try {
					for await (const event of session.sendStream(msg.prompt.trim())) {
						this.sendWS(ws, {
							type: "event",
							sessionId,
							event,
						});
					}
				} catch (err: any) {
					this.sendWS(ws, {
						type: "error",
						sessionId,
						error: err.message || "Error executing turn.",
					});
				}
			}
		} catch (err: any) {
			this.sendWS(ws, {
				type: "error",
				error: `Invalid WS message format: ${err.message}`,
			});
		}
	}

	public handleClose(ws: ServerWebSocket<WSClientData>): void {
		for (const resolver of ws.data.pendingApprovals.values()) {
			resolver(false); // Clean reject pending approvals on socket close
		}
		ws.data.pendingApprovals.clear();
	}

	private sendWS(ws: ServerWebSocket<WSClientData>, msg: WSServerMessage): void {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// Socket closed
		}
	}
}
