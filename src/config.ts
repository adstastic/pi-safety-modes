import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Action, Mode, SafetyConfig } from "./types.js";

export const DEFAULT_CONFIG: SafetyConfig = {
	mode: "blocklist",
	readOnlyAllow: [
		"git.status",
		"git.diff",
		"git.log",
		"git.show",
		"git.blame",
		"git.grep",
		"git.remote.view",
		"git.branch.list",
		"git.tag.list",
		"fs.list",
		"fs.read",
		"search.grep",
		"search.find",
	],
	rules: {
		"git.reset.hard": "deny",
		"git.clean.force": "deny",
		"shell.pipe-to-shell": "deny",
		"shell.exec": "ask",
		"tool.task": "ask",
		"tool.mcp": "ask",
	},
};

export interface LoadedSafetyConfig {
	path: string;
	config: SafetyConfig;
	warnings: string[];
	raw: Record<string, unknown>;
}

const modeAliases: Record<string, Mode> = {
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
const actions = new Set<Action>(["allow", "ask", "deny"]);

export function parseMode(value: unknown): Mode | undefined {
	return typeof value === "string" ? modeAliases[value.trim().toLowerCase()] : undefined;
}

export function getConfigPath(agentDir = getAgentDir()): string {
	return join(agentDir, "extensions", "pi-safety-modes", "config.json");
}

export async function loadSafetyConfig(agentDir?: string): Promise<LoadedSafetyConfig> {
	const path = getConfigPath(agentDir);
	const warnings: string[] = [];
	let raw: Record<string, unknown> = cloneConfig(DEFAULT_CONFIG) as unknown as Record<string, unknown>;

	try {
		const text = await readFile(path, "utf8");
		const parsed = JSON.parse(text) as unknown;
		if (isRecord(parsed)) raw = { ...parsed };
		else warnings.push("Config root must be an object; using defaults.");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			warnings.push(`Could not read config; using defaults: ${(error as Error).message}`);
		}
	}

	return { path, raw, warnings, config: normalizeConfig(raw, warnings) };
}

export async function setConfigMode(mode: Mode, agentDir?: string): Promise<LoadedSafetyConfig> {
	const loaded = await loadSafetyConfig(agentDir);
	const raw = { ...loaded.raw, mode };
	await writeRawConfig(loaded.path, raw);
	return loadSafetyConfig(agentDir);
}

export async function setRuleActions(ops: string[], action: Action, agentDir?: string): Promise<LoadedSafetyConfig> {
	const loaded = await loadSafetyConfig(agentDir);
	const existingRules = isRecord(loaded.raw.rules) ? { ...loaded.raw.rules } : { ...loaded.config.rules };
	for (const op of ops) existingRules[op] = action;
	await writeRawConfig(loaded.path, { ...loaded.raw, rules: existingRules });
	return loadSafetyConfig(agentDir);
}

export async function writeRawConfig(path: string, raw: Record<string, unknown>): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		await writeFile(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
		await rename(tmp, path);
	} catch (error) {
		await unlink(tmp).catch(() => undefined);
		throw error;
	}
}

function normalizeConfig(raw: Record<string, unknown>, warnings: string[]): SafetyConfig {
	const config = cloneConfig(DEFAULT_CONFIG);

	const mode = parseMode(raw.mode);
	if (mode) config.mode = mode;
	else if (raw.mode !== undefined) warnings.push(`Invalid mode ${JSON.stringify(raw.mode)}; using blocklist.`);

	if (raw.readOnlyAllow !== undefined) {
		if (Array.isArray(raw.readOnlyAllow)) {
			config.readOnlyAllow = raw.readOnlyAllow.filter((entry): entry is string => {
				const ok = typeof entry === "string" && entry.length > 0;
				if (!ok) warnings.push(`Ignoring invalid readOnlyAllow entry: ${JSON.stringify(entry)}`);
				return ok;
			});
		} else warnings.push("Invalid readOnlyAllow; using defaults.");
	}

	if (raw.rules !== undefined) {
		if (isRecord(raw.rules)) {
			for (const [op, action] of Object.entries(raw.rules)) {
				if (actions.has(action as Action)) config.rules[op] = action as Action;
				else warnings.push(`Ignoring invalid action for ${op}: ${JSON.stringify(action)}`);
			}
		} else warnings.push("Invalid rules; using defaults.");
	}

	return config;
}

function cloneConfig(config: SafetyConfig): SafetyConfig {
	return { mode: config.mode, readOnlyAllow: [...config.readOnlyAllow], rules: { ...config.rules } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
