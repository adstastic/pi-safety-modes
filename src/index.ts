import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { analyzeBash } from "./bash-ast.js";
import { loadSafetyConfig, parseMode, setConfigMode, setRuleActions } from "./config.js";
import { decideToolCall } from "./policy.js";
import type { Mode, PolicyDecision } from "./types.js";

export interface SafetyExtensionOptions {
	agentDir?: string;
}

const modeCycle: Mode[] = ["blocklist", "readonly", "off"];
const ANSI_RESET = "\u001b[0m";
const statusColors: Record<Mode, string> = {
	readonly: "\u001b[32m",
	blocklist: "\u001b[33m",
	off: "\u001b[31m",
};

export default function registerSafetyModes(pi: ExtensionAPI, options: SafetyExtensionOptions = {}): void {
	const agentDir = options.agentDir;

	pi.on("session_start", async (_event, ctx) => {
		const loaded = await loadSafetyConfig(agentDir);
		setStatus(ctx, loaded.config.mode);
		for (const warning of loaded.warnings) ctx.ui.notify(`pi-safety-modes: ${warning}`, "warning");
	});

	pi.on("tool_call", async (event, ctx) => {
		const loaded = await loadSafetyConfig(agentDir);
		setStatus(ctx, loaded.config.mode);
		const command = event.toolName === "bash" ? getBashCommand(event) : undefined;
		const bash = command !== undefined ? await analyzeBash(command) : undefined;
		const decision = decideToolCall({ mode: loaded.config.mode, toolName: event.toolName, bash, config: loaded.config });
		return handleDecision(decision, ctx, agentDir, command);
	});

	pi.registerShortcut("alt+s", {
		description: "Cycle safety mode (blocklist → readonly → off)",
		handler: async (ctx) => cycleSafetyMode(ctx, agentDir),
	});

	pi.registerCommand("safety-mode", {
		description: "Show or set safety mode (readonly, blocklist, off)",
		handler: async (args, ctx) => {
			const requested = args.trim();
			if (!requested) {
				const loaded = await loadSafetyConfig(agentDir);
				setStatus(ctx, loaded.config.mode);
				ctx.ui.notify(`Safety mode: ${loaded.config.mode}\nConfig: ${loaded.path}`, "info");
				return;
			}

			const mode = parseMode(requested);
			if (!mode) {
				ctx.ui.notify("Usage: /safety-mode [readonly|blocklist|off]", "warning");
				return;
			}

			const loaded = await setConfigMode(mode, agentDir);
			setStatus(ctx, loaded.config.mode);
			ctx.ui.notify(`Safety mode set to ${loaded.config.mode}\nConfig: ${loaded.path}`, "info");
		},
	});
}

async function cycleSafetyMode(ctx: { ui: { notify: (message: string, level?: "info" | "warning" | "error") => void; setStatus?: (key: string, text: string | undefined) => void } }, agentDir?: string): Promise<void> {
	const loaded = await loadSafetyConfig(agentDir);
	const index = modeCycle.indexOf(loaded.config.mode);
	const nextMode = modeCycle[(index + 1) % modeCycle.length] ?? modeCycle[0];
	const updated = await setConfigMode(nextMode, agentDir);
	setStatus(ctx, updated.config.mode);
	ctx.ui.notify(`Safety mode: ${loaded.config.mode} → ${updated.config.mode}`, "info");
}

async function handleDecision(decision: PolicyDecision, ctx: { hasUI: boolean; ui: { select: (title: string, options: string[]) => Promise<string | undefined> } }, agentDir?: string, command?: string): Promise<ToolCallEventResult | undefined> {
	if (decision.action === "allow") return undefined;
	if (decision.action === "deny") return { block: true, reason: decision.reason };

	if (!ctx.hasUI) return { block: true, reason: `${decision.reason} (no UI available for confirmation)` };

	const ops = decision.askOps.join(", ");
	const alwaysAllow = decision.askOps.length === 1 ? `Always allow ${decision.askOps[0]}` : "Always allow these operations";
	const alwaysDeny = decision.askOps.length === 1 ? `Always deny ${decision.askOps[0]}` : "Always deny these operations";
	const canPersistAll = decision.askOps.length > 0 && decision.askOps.every((op) => decision.allowPersistableOps.includes(op));
	const options = canPersistAll
		? ["Allow once", alwaysAllow, "Deny once", alwaysDeny]
		: ["Allow once", "Deny once"];

	const commandLine = command ? `\n\nCommand: ${preview(command)}` : "";
	const choice = await ctx.ui.select(`Safety check: ${decision.reason}\n\nOperation${decision.askOps.length === 1 ? "" : "s"}: ${ops}${commandLine}`, options);
	if (choice === "Allow once") return undefined;
	if (choice === alwaysAllow && canPersistAll) {
		await setRuleActions(decision.allowPersistableOps, "allow", agentDir);
		return undefined;
	}
	if (choice === alwaysDeny && canPersistAll) {
		await setRuleActions(decision.allowPersistableOps, "deny", agentDir);
		return { block: true, reason: `Blocked and saved deny rule for: ${decision.allowPersistableOps.join(", ")}` };
	}
	return { block: true, reason: "Blocked by safety-mode confirmation" };
}

function preview(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

function setStatus(ctx: { ui: { setStatus?: (key: string, text: string | undefined) => void } }, mode: Mode): void {
	ctx.ui.setStatus?.("pi-safety-modes", `${statusColors[mode]}safety:${mode}${ANSI_RESET}`);
}

function getBashCommand(event: ToolCallEvent): string | undefined {
	const input = event.input as Record<string, unknown>;
	return typeof input.command === "string" ? input.command : undefined;
}
