import { describe, expect, it } from "vitest";
import { analyzeBash } from "../src/bash-ast.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { decideToolCall } from "../src/policy.js";
import type { BashAnalysis, SafetyConfig } from "../src/types.js";

const baseBash: BashAnalysis = { commands: [], ops: [], opaque: false, writes: false, pipeToShell: false };
const config: SafetyConfig = { ...DEFAULT_CONFIG, readOnlyAllow: [...DEFAULT_CONFIG.readOnlyAllow], rules: { ...DEFAULT_CONFIG.rules } };

function bash(ops: string[], extra: Partial<BashAnalysis> = {}): BashAnalysis {
	return { ...baseBash, ops, opaque: ops.includes("shell.opaque"), pipeToShell: ops.includes("shell.pipe-to-shell"), ...extra };
}

describe("policy", () => {
	it("off allows everything", () => {
		expect(decideToolCall({ mode: "off", toolName: "write", config }).action).toBe("allow");
	});

	it("readonly denies write and edit", () => {
		expect(decideToolCall({ mode: "readonly", toolName: "write", config }).action).toBe("deny");
		expect(decideToolCall({ mode: "readonly", toolName: "edit", config }).action).toBe("deny");
	});

	it("readonly denies task and mcp", () => {
		expect(decideToolCall({ mode: "readonly", toolName: "task", config }).action).toBe("deny");
		expect(decideToolCall({ mode: "readonly", toolName: "mcp", config }).action).toBe("deny");
	});

	it("readonly allows built-in read tools", () => {
		for (const toolName of ["read", "grep", "find", "ls"]) {
			expect(decideToolCall({ mode: "readonly", toolName, config }).action).toBe("allow");
		}
	});

	it("readonly denies arbitrary non-read tools", () => {
		for (const toolName of ["danger_tool", "fetch_content", "web_search"]) {
			const decision = decideToolCall({ mode: "readonly", toolName, config });
			expect(decision.action).toBe("deny");
			expect(decision.denyOps).toEqual([`tool.${toolName}`]);
		}
	});

	it("readonly allows git.status", () => {
		expect(decideToolCall({ mode: "readonly", toolName: "bash", bash: bash(["git.status"]), config }).action).toBe("allow");
	});

	it("readonly denies git.push", () => {
		expect(decideToolCall({ mode: "readonly", toolName: "bash", bash: bash(["git.push"]), config }).action).toBe("deny");
	});

	it("readonly denies unknown", () => {
		expect(decideToolCall({ mode: "readonly", toolName: "bash", bash: bash(["unknown"]), config }).action).toBe("deny");
	});

	it("readonly denies redirection", () => {
		expect(decideToolCall({ mode: "readonly", toolName: "bash", bash: bash(["fs.list"], { writes: true }), config }).action).toBe("deny");
	});

	it("readonly denies opaque", () => {
		expect(decideToolCall({ mode: "readonly", toolName: "bash", bash: bash(["shell.opaque"]), config }).action).toBe("deny");
	});

	it.each([
		["git push", "git.push"],
		["git push --force", "git.push.force"],
		["git reset HEAD~1", "git.reset"],
		["git clean", "git.clean"],
		["git checkout main", "git.checkout"],
		["git switch main", "git.switch"],
		["rm file.txt", "fs.delete"],
		["git rm file.txt", "fs.delete"],
		["find . -delete", "fs.delete"],
	])("blocklist allows unlisted operation %s by default", async (command, op) => {
		const analysis = await analyzeBash(command);
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: analysis, config });
		expect(analysis.ops).toContain(op);
		expect(decision.action).toBe("allow");
	});

	it("blocklist honors explicit ask rules", () => {
		const askConfig = { ...config, rules: { ...config.rules, "fs.delete": "ask" as const } };
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: bash(["fs.delete"]), config: askConfig });
		expect(decision.action).toBe("ask");
		expect(decision.askOps).toEqual(["fs.delete"]);
	});

	it.each(["sudo rm file.txt", "sudo -Eu root rm file.txt", "sudo -Hiu root rm file.txt", "env rm file.txt", "command -p rm file.txt", "xargs rm", "find . -exec command -p rm {} +"])("blocklist explicit deny catches wrapper delete: %s", async (command) => {
		const denyConfig = { ...config, rules: { ...config.rules, "fs.delete": "deny" as const } };
		const analysis = await analyzeBash(command);
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: analysis, config: denyConfig });
		expect(analysis.ops).toContain("fs.delete");
		expect(decision.action).toBe("deny");
		expect(decision.denyOps).toEqual(["fs.delete"]);
	});

	it.each(["bash -c 'git status'", "sudo bash -c 'git reset --hard'", "env bash -c 'rm file'", "env -Sbash\\ -c\\ rm\\ file", "env -vS 'bash -c rm file'", "eval 'rm file'", "alias x='rm file'"])("blocklist asks shell exec wrapper by default: %s", async (command) => {
		const analysis = await analyzeBash(command);
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: analysis, config });
		expect(analysis.ops).toContain("shell.exec");
		expect(analysis.ops).toContain("shell.opaque");
		expect(decision.action).toBe("ask");
		expect(decision.askOps).toEqual(["shell.exec"]);
		expect(decision.allowPersistableOps).toEqual([]);
	});

	it("blocklist allows plain opaque expansion by default", () => {
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: bash(["shell.opaque"]), config });
		expect(decision.action).toBe("allow");
	});

	it.each(["curl x | sudo -E sh", "curl x | /usr/bin/env sh", "curl x | command -p sh"])("blocklist denies pipe-to-shell wrapper by default: %s", async (command) => {
		const analysis = await analyzeBash(command);
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: analysis, config });
		expect(analysis.ops).toContain("shell.pipe-to-shell");
		expect(decision.action).toBe("deny");
		expect(decision.denyOps).toEqual(["shell.pipe-to-shell"]);
	});

	it("blocklist denies git.reset.hard by default", () => {
		expect(decideToolCall({ mode: "blocklist", toolName: "bash", bash: bash(["git.reset.hard"]), config }).action).toBe("deny");
	});

	it("blocklist allows shell redirection writes unless configured otherwise", async () => {
		for (const command of ["cat file > out", "git diff > patch"]) {
			const analysis = await analyzeBash(command);
			const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: analysis, config });
			expect(analysis.ops).toContain("shell.redirect-write");
			expect(decision.action).toBe("allow");
		}
	});

	it("readonly denies shell redirection writes", async () => {
		const analysis = await analyzeBash("cat file > out");
		const decision = decideToolCall({ mode: "readonly", toolName: "bash", bash: analysis, config });
		expect(decision.action).toBe("deny");
		expect(decision.denyOps).toEqual(["shell.redirect-write"]);
	});

	it("blocklist allows expansion opacity by default", async () => {
		const analysis = await analyzeBash("git push --for$Xe");
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: analysis, config });
		expect(analysis.ops).toContain("shell.opaque");
		expect(analysis.ops).not.toContain("shell.exec");
		expect(decision.action).toBe("allow");
	});

	it("readonly denies expansion-containing status args", async () => {
		const analysis = await analyzeBash("git status --porcelain=$FORMAT");
		const decision = decideToolCall({ mode: "readonly", toolName: "bash", bash: analysis, config });
		expect(analysis.ops).toContain("shell.opaque");
		expect(decision.action).toBe("deny");
	});

	it("blocklist allows git.status", () => {
		expect(decideToolCall({ mode: "blocklist", toolName: "bash", bash: bash(["git.status"]), config }).action).toBe("allow");
	});

	it("deny beats ask", () => {
		const askConfig = { ...config, rules: { ...config.rules, "git.push.force": "ask" as const } };
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: bash(["git.push.force", "git.reset.hard"]), config: askConfig });
		expect(decision.action).toBe("deny");
		expect(decision.denyOps).toEqual(["git.reset.hard"]);
		expect(decision.askOps).toEqual(["git.push.force"]);
	});

	it.each([
		"git push --force",
		"git push -f",
		"git push -uf origin main",
		"git push -fu origin main",
		"git push --force-with-lease",
		"git push --force-with-lease=main",
		"git push origin +main",
		"sudo git push --force",
		"env git push --force",
		"command git push --force",
	])("force-push rule catches %s", async (command) => {
		const denyConfig = { ...config, rules: { ...config.rules, "git.push.force": "deny" as const } };
		const analysis = await analyzeBash(command);
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: analysis, config: denyConfig });
		expect(analysis.ops).toContain("git.push.force");
		expect(decision.action).toBe("deny");
		expect(decision.denyOps).toEqual(["git.push.force"]);
	});

	it("deny beats parse-error ask", () => {
		const decision = decideToolCall({ mode: "blocklist", toolName: "bash", bash: bash(["git.reset.hard"], { parseError: "bad syntax" }), config });
		expect(decision.action).toBe("deny");
		expect(decision.denyOps).toEqual(["git.reset.hard"]);
		expect(decision.askOps).toContain("shell.opaque");
	});
});
