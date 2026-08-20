import type { SDKEvent, SDKSessionState, SDKTurnResult } from "../sdk/types.ts";

export interface GatewayConfig {
	port?: number;
	host?: string;
	authToken?: string;
	projectRoot?: string;
	corsOrigins?: string[];
	defaultProvider?: string;
	defaultModel?: string;
	approvalMode?: "auto" | "manual" | "yolo";
	mode?: "plan" | "build";
}

export interface SessionSummary {
	sessionId: string;
	createdAt: string;
	updatedAt: string;
	state: SDKSessionState;
}

export interface CreateSessionRequest {
	sessionName?: string;
	provider?: string;
	model?: string;
	mode?: "plan" | "build";
	approvalMode?: "auto" | "manual" | "yolo";
}

export interface CreateSessionResponse {
	sessionId: string;
	sessionName?: string;
	state: SDKSessionState;
}

export interface PostMessageRequest {
	prompt: string;
	stream?: boolean;
}

export interface PostMessageResponse {
	sessionId: string;
	turn: SDKTurnResult;
}

export interface WSClientMessage {
	type: "prompt" | "approval_response" | "ping";
	sessionId?: string;
	prompt?: string;
	requestId?: string;
	approved?: boolean;
}

export interface WSServerMessage {
	type: "event" | "approval_request" | "pong" | "error";
	sessionId?: string;
	event?: SDKEvent;
	requestId?: string;
	toolName?: string;
	toolInput?: Record<string, unknown>;
	error?: string;
}
