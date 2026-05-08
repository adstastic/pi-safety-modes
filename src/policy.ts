import type { Action, BashAnalysis, Mode, PolicyDecision, SafetyConfig } from "./types.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const NON_PERSISTABLE_ASK_OPS = new Set(["unknown", "shell.opaque", "shell.exec", "shell.redirect-write"]);

export function decideToolCall(input: {
	mode: Mode;
	toolName: string;
	bash?: BashAnalysis;
	config: SafetyConfig;
}): PolicyDecision {
	const { mode, toolName, bash, config } = input;
	if (mode === "off") return allow("safety off");

	if (mode === "readonly") return decideReadOnly(toolName, bash, config);
	return decideBlocklist(toolName, bash, config);
}

function decideReadOnly(toolName: string, bash: BashAnalysis | undefined, config: SafetyConfig): PolicyDecision {
	if (READ_ONLY_TOOLS.has(toolName)) return allow("readonly tool allowed");
	if (toolName === "write" || toolName === "edit") return deny([toolName], `${toolName} mutates files in readonly mode`);
	if (isTaskTool(toolName)) return deny(["tool.task"], "task tools are disabled in readonly mode");
	if (isMcpTool(toolName)) return deny(["tool.mcp"], "MCP tools are disabled in readonly mode");
	if (toolName !== "bash") return deny([readOnlyToolOp(toolName)], `${toolName || "unknown tool"} is not allowed in readonly mode`);
	if (!bash) return deny(["shell.opaque"], "missing bash analysis");
	if (bash.parseError) return deny(["shell.opaque"], `bash parse failed: ${bash.parseError}`);
	if (bash.writes) return deny(["shell.redirect-write"], "bash redirection may write files");
	if (bash.opaque) return deny(["shell.opaque"], "opaque shell evaluation is not allowed in readonly mode");
	if (bash.pipeToShell) return deny(["shell.pipe-to-shell"], "piping into a shell is not allowed in readonly mode");

	const allowed = new Set(config.readOnlyAllow);
	const denied = bashOps(bash).filter((op) => !allowed.has(op));
	return denied.length > 0 ? deny(denied, `operation not allowed in readonly mode: ${denied.join(", ")}`) : allow("all bash operations are readonly allowed");
}

function decideBlocklist(toolName: string, bash: BashAnalysis | undefined, config: SafetyConfig): PolicyDecision {
	if (isTaskTool(toolName)) return decideOps(["tool.task"], config, "task tool requires confirmation");
	if (isMcpTool(toolName)) return decideOps(["tool.mcp"], config, "MCP tool requires confirmation");
	if (toolName !== "bash") return allow("tool allowed in blocklist mode");
	if (!bash) return ask(["shell.opaque"], "missing bash analysis");
	const ops = bashOps(bash);
	if (bash.parseError) {
		const decision = decideOps(ops, config, `bash parse failed: ${bash.parseError}`);
		if (decision.action === "deny") return { ...decision, askOps: unique([...decision.askOps, "shell.opaque"]) };
		return ask(unique([...decision.askOps, "shell.opaque"]), `bash parse failed: ${bash.parseError}`);
	}
	return decideOps(ops, config, "bash operation requires confirmation");
}

function decideOps(ops: string[], config: SafetyConfig, askReason: string): PolicyDecision {
	const denyOps: string[] = [];
	const askOps: string[] = [];
	for (const op of unique(ops)) {
		const action = config.rules[op] ?? "allow";
		if (action === "deny") denyOps.push(op);
		else if (action === "ask") askOps.push(op);
	}
	if (denyOps.length > 0) return deny(denyOps, `blocked operation: ${denyOps.join(", ")}`, askOps);
	if (askOps.length > 0) return ask(askOps, askReason);
	return allow("allowed by blocklist mode");
}

function allow(reason: string): PolicyDecision {
	return { action: "allow", reason, askOps: [], denyOps: [], allowPersistableOps: [] };
}

function ask(askOps: string[], reason: string): PolicyDecision {
	const ops = unique(askOps);
	return { action: "ask", reason, askOps: ops, denyOps: [], allowPersistableOps: ops.filter((op) => !NON_PERSISTABLE_ASK_OPS.has(op)) };
}

function deny(denyOps: string[], reason: string, askOps: string[] = []): PolicyDecision {
	return { action: "deny", reason, askOps: unique(askOps), denyOps: unique(denyOps), allowPersistableOps: [] };
}

function bashOps(bash: BashAnalysis): string[] {
	return bash.writes ? unique([...bash.ops, "shell.redirect-write"]) : bash.ops;
}

function readOnlyToolOp(toolName: string): string {
	return /^[A-Za-z0-9_.-]+$/.test(toolName) ? `tool.${toolName}` : "tool.unknown";
}

function isTaskTool(toolName: string): boolean {
	return toolName === "task";
}

function isMcpTool(toolName: string): boolean {
	return toolName === "mcp" || toolName.startsWith("mcp.") || toolName.startsWith("mcp__");
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
