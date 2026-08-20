import type { Server, ServerWebSocket } from "bun";
import { Harness } from "../sdk/harness.ts";
import { GatewayRoutes } from "./routes.ts";
import type { GatewayConfig } from "./types.ts";
import { WebSocketGatewayHandler, type WSClientData } from "./websocket.ts";

export class GatewayServer {
	private server?: ReturnType<typeof Bun.serve>;
	private harness: Harness;
	private routes: GatewayRoutes;
	private wsHandler: WebSocketGatewayHandler;
	private config: GatewayConfig;

	constructor(config: GatewayConfig = {}) {
		this.config = {
			port: config.port || 3000,
			host: config.host || "0.0.0.0",
			authToken: config.authToken,
			projectRoot: config.projectRoot || process.cwd(),
			corsOrigins: config.corsOrigins || ["*"],
			defaultProvider: config.defaultProvider,
			defaultModel: config.defaultModel,
			approvalMode: config.approvalMode || "auto",
			mode: config.mode || "build",
		};

		this.harness = new Harness({
			projectRoot: this.config.projectRoot,
			provider: this.config.defaultProvider,
			model: this.config.defaultModel,
			approvalMode: this.config.approvalMode,
			mode: this.config.mode,
		});

		this.routes = new GatewayRoutes(this.harness, this.config);
		this.wsHandler = new WebSocketGatewayHandler(
			(id) => this.routes.getSessionsMap().get(id),
			this.config,
		);
	}

	public getPort(): number {
		return this.server?.port || this.config.port || 3000;
	}

	public getHarness(): Harness {
		return this.harness;
	}

	public getRoutes(): GatewayRoutes {
		return this.routes;
	}

	public isRunning(): boolean {
		return Boolean(this.server);
	}

	public async start(): Promise<{ port: number; url: string }> {
		if (this.server) {
			const activePort = this.server.port ?? this.config.port ?? 3000;
			return { port: activePort, url: this.server.url.toString() };
		}

		const port = this.config.port || 3000;
		const hostname = this.config.host || "0.0.0.0";
		const routes = this.routes;
		const wsHandler = this.wsHandler;
		const authToken = this.config.authToken;

		this.server = Bun.serve<WSClientData>({
			port,
			hostname,
			async fetch(req, server) {
				const url = new URL(req.url);
				if (url.pathname === "/api/v1/ws") {
					const upgraded = server.upgrade(req, {
						data: {
							authenticated: !authToken,
							pendingApprovals: new Map(),
						},
					});
					if (upgraded) return undefined;
					return new Response("WebSocket upgrade failed", { status: 400 });
				}

				return routes.handleRequest(req);
			},
			websocket: {
				open(ws) {
					wsHandler.handleOpen(ws);
				},
				message(ws, msg) {
					wsHandler.handleMessage(ws, msg);
				},
				close(ws) {
					wsHandler.handleClose(ws);
				},
			},
		});

		const boundPort = this.server.port ?? port;
		const serverUrl = `http://${this.server.hostname}:${boundPort}`;
		return {
			port: boundPort,
			url: serverUrl,
		};
	}

	public async stop(): Promise<void> {
		if (this.server) {
			this.server.stop(true);
			this.server = undefined;
		}

		for (const record of this.routes.getSessionsMap().values()) {
			record.session.reset();
		}
		this.routes.getSessionsMap().clear();
	}
}
