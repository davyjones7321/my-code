import type { LoopEvent, Message, ToolDefinition } from "../agent/types.ts";
import type { ContextManager } from "../context/manager.ts";
import type { ControlLayer } from "../control/index.ts";
import type { Provider, ProviderCallConfig } from "../providers/base.ts";
import type { ToolRegistry } from "../tools/registry.ts";

/**
 * Lifecycle states of a subagent instance
 */
export type SubagentLifecycleState =
	| "idle"
	| "running"
	| "waiting_for_message"
	| "errored"
	| "done"
	| "terminated";

/**
 * Backward compatibility / status alias
 */
export type SubagentStatus = SubagentLifecycleState;

/**
 * Built-in subagent archetypes
 */
export type BuiltinSubagentType = "research" | "code-reviewer" | "test-engineer";

/**
 * Message direction in multi-agent communication
 */
export type MessageDirection =
	| "parent_to_child"
	| "child_to_parent"
	| "peer_to_peer"
	| "system";

/**
 * Subagent message structure passed between agents
 */
export interface SubagentMessage {
	id: string;
	fromId: string;
	toId: string;
	content: string;
	timestamp: number;
	direction: MessageDirection;
	metadata?: Record<string, unknown>;
	replyToId?: string;
}

/**
 * Result of delivering a message
 */
export interface MessageDeliveryResult {
	success: boolean;
	messageId: string;
	recipientId: string;
	recipientState: SubagentLifecycleState;
	delivered: boolean;
	queued: boolean;
	error?: string;
	response?: string;
}

/**
 * Definition of a reusable subagent role/type
 */
export interface SubagentDefinition {
	name: string;
	description: string;
	systemPrompt: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	mode?: "plan" | "build";
	defaultModel?: string;
	maxIterations?: number;
	defaultMaxIterations?: number;
	temperature?: number;
	isBuiltin?: boolean;
	customConfig?: Record<string, unknown>;
	providerOverride?: string;
	modelOverride?: string;
}

/**
 * Specification passed when invoking a subagent instance
 */
export interface SubagentInvocationSpec {
	type?: string;
	prompt: string;
	name?: string;
	systemPrompt?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	provider?: string;
	model?: string;
	maxIterations?: number;
	parentConversationId?: string;
	metadata?: Record<string, unknown>;
	waitForCompletion?: boolean;
	background?: boolean;
	timeoutMs?: number;
}

/**
 * Execution result returned upon subagent completion
 */
export interface SubagentExecutionResult {
	instanceId: string;
	subagentId?: string;
	name: string;
	type: string;
	state: SubagentLifecycleState;
	status?: SubagentLifecycleState;
	output: string;
	response?: string;
	totalIterations: number;
	toolCallsCount: number;
	durationMs: number;
	error?: string;
	tokenUsage?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	artifacts?: Record<string, unknown>;
	events?: LoopEvent[];
}

/**
 * Backward compatibility alias for SubagentExecutionResult
 */
export type SubagentRunResult = SubagentExecutionResult;

/**
 * Subagent log / audit entry
 */
export interface SubagentLogEntry {
	timestamp: number;
	level: "info" | "warn" | "error" | "debug";
	type: "state_change" | "tool_call" | "tool_result" | "message" | "error" | "output";
	message: string;
	details?: Record<string, unknown>;
}

/**
 * Runtime instance representing a spawned subagent
 */
export interface SubagentInstance {
	id: string;
	name: string;
	type: string;
	parentId?: string;
	childIds: string[];
	state: SubagentLifecycleState;
	status?: SubagentLifecycleState;
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	completedAt?: number;
	contextManager: ContextManager;
	toolRegistry: ToolRegistry;
	controlLayer?: ControlLayer;
	provider: Provider;
	definition: SubagentDefinition;
	spec: SubagentInvocationSpec;
	systemPrompt: string;
	allowedTools: string[];
	maxIterations: number;
	model?: string;
	inbox: SubagentMessage[];
	mailbox?: SubagentMessage[];
	messageHistory: SubagentMessage[];
	logs: SubagentLogEntry[];
	events: LoopEvent[];
	result?: SubagentExecutionResult;
	error?: Error | string;
	abortController: AbortController;
	taskPromise?: Promise<SubagentExecutionResult>;
	executionPromise?: Promise<SubagentExecutionResult>;
}

/**
 * Hierarchical tree node representing subagent hierarchy
 */
export interface SubagentTreeNode {
	instance: SubagentInstance;
	children: SubagentTreeNode[];
}

/**
 * Management actions
 */
export type ManageSubagentAction = "list" | "status" | "terminate" | "logs";

export interface ManageSubagentsInput {
	action: ManageSubagentAction;
	subagentId?: string;
	recursive?: boolean;
	parentId?: string;
}

export interface SubagentSummary {
	id: string;
	name: string;
	type: string;
	parentId?: string;
	state: SubagentLifecycleState;
	createdAt: number;
	completedAt?: number;
	childCount: number;
	totalIterations?: number;
}

export interface SubagentStatusDetail extends SubagentSummary {
	logsCount: number;
	inboxSize: number;
	messageCount: number;
	outputPreview?: string;
	error?: string;
	durationMs?: number;
}

export interface ManageSubagentsResult {
	action: ManageSubagentAction;
	success: boolean;
	message?: string;
	subagents?: SubagentSummary[];
	status?: SubagentStatusDetail;
	logs?: SubagentLogEntry[];
	terminated?: boolean;
}

/**
 * Subagent event definitions
 */
export type SubagentEventType =
	| "instance_created"
	| "state_changed"
	| "message_queued"
	| "message_delivered"
	| "tool_executed"
	| "completed"
	| "errored"
	| "terminated"
	| "subagent:created"
	| "subagent:status_changed"
	| "subagent:loop_event"
	| "subagent:message_sent"
	| "subagent:completed"
	| "subagent:error";

export interface SubagentEvent {
	type: SubagentEventType;
	instanceId: string;
	subagentId?: string;
	timestamp: number;
	data: Record<string, unknown>;
	instance?: SubagentInstance;
	message?: SubagentMessage;
	result?: SubagentExecutionResult;
	error?: Error | string;
	event?: LoopEvent;
	oldStatus?: SubagentLifecycleState;
	newStatus?: SubagentLifecycleState;
}
