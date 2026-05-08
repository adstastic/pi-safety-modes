export type Mode = "off" | "blocklist" | "readonly";
export type Action = "allow" | "ask" | "deny";

export interface SafetyConfig {
	mode: Mode;
	readOnlyAllow: string[];
	rules: Record<string, Action>;
}

export interface BashAnalysis {
	commands: string[][];
	ops: string[];
	opaque: boolean;
	writes: boolean;
	pipeToShell: boolean;
	parseError?: string;
}

export interface PolicyDecision {
	action: Action;
	reason: string;
	askOps: string[];
	denyOps: string[];
	allowPersistableOps: string[];
}
