import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { analyzeBash } from "./bash-ast.js";
import { loadSafetyConfig, setConfigMode, setRuleActions } from "./config.js";
import { decideToolCall } from "./policy.js";
import type { Mode, PolicyDecision } from "./types.js";

export interface SafetyExtensionOptions {
	agentDir?: string;
}

const aliases: Record<string, Mode> = {
	off: "off",
	unrestricted: "off",
	blocklist: "blocklist",
	protected: "blocklist",
	protect: "blocklist",
	rules: "blocklist",
	denylist: "blocklist",
	readonly: "readonly",
	"read-only": "readonly",
	ro: "readonly",
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

	pi.registerCommand("safety-mode", {
		description: "Show or set safety mode (readonly, blocklist, off)",
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (!requested) {
				const loaded = await loadSafetyConfig(agentDir);
				setStatus(ctx, loaded.config.mode);
				ctx.ui.notify(`Safety mode: ${loaded.config.mode}\nConfig: ${loaded.path}`, "info");
				return;
			}

			const mode = aliases[requested];
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
	ctx.ui.setStatus?.("pi-safety-modes", `safety:${mode}`);
}

function getBashCommand(event: ToolCallEvent): string | undefined {
	const input = event.input as Record<string, unknown>;
	return typeof input.command === "string" ? input.command : undefined;
}
