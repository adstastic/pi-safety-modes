import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import registerSafetyModes from "../src/index.js";
import { getConfigPath, setConfigMode, setRuleActions } from "../src/config.js";

type Handler = (event: any, ctx: any) => Promise<any> | any;

function createMock(agentDir: string) {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, any>();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
		registerCommand: vi.fn((name: string, command: any) => commands.set(name, command)),
	};
	const ctx = {
		hasUI: true,
		ui: {
			select: vi.fn<(title: string, options: string[]) => Promise<string | undefined>>(),
			notify: vi.fn(),
			setStatus: vi.fn(),
		},
	};
	registerSafetyModes(pi as any, { agentDir });
	return { handlers, commands, ctx };
}

async function tempAgentDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "pi-safety-modes-"));
}

describe("extension integration", () => {
	let agentDir: string;

	beforeEach(async () => {
		agentDir = await tempAgentDir();
	});

	it("registers /safety-mode command", () => {
		const { commands } = createMock(agentDir);
		expect(commands.has("safety-mode")).toBe(true);
	});

	it("tool_call blocks write in readonly", async () => {
		await setConfigMode("readonly", agentDir);
		const { handlers, ctx } = createMock(agentDir);
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "write", input: {} }, ctx);
		expect(result).toEqual(expect.objectContaining({ block: true }));
	});

	it("tool_call asks for explicitly configured force push in blocklist", async () => {
		await setRuleActions(["git.push.force"], "ask", agentDir);
		const { handlers, ctx } = createMock(agentDir);
		ctx.ui.select.mockResolvedValue("Allow once");
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "bash", input: { command: "git push --force" } }, ctx);
		expect(ctx.ui.select).toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("does not offer persistent choices when ask ops include unknown", async () => {
		await setRuleActions(["unknown"], "ask", agentDir);
		const { handlers, ctx } = createMock(agentDir);
		ctx.ui.select.mockResolvedValue("Allow once");
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "bash", input: { command: "nope && git push --force" } }, ctx);
		expect(ctx.ui.select.mock.calls[0]?.[0]).toContain("Command: nope && git push --force");
		expect(ctx.ui.select.mock.calls[0]?.[1]).toEqual(["Allow once", "Deny once"]);
		expect(result).toBeUndefined();
	});

	it("does not offer persistent choices for shell.opaque", async () => {
		const { handlers, ctx } = createMock(agentDir);
		ctx.ui.select.mockResolvedValue("Allow once");
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "bash", input: { command: "git status --porcelain=$FORMAT" } }, ctx);
		expect(ctx.ui.select.mock.calls[0]?.[1]).toEqual(["Allow once", "Deny once"]);
		expect(result).toBeUndefined();
	});

	it("does not offer persistent choices when shell.opaque is mixed with git.push.force", async () => {
		const { handlers, ctx } = createMock(agentDir);
		ctx.ui.select.mockResolvedValue("Allow once");
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "bash", input: { command: "git push --force $REMOTE" } }, ctx);
		expect(ctx.ui.select.mock.calls[0]?.[1]).toEqual(["Allow once", "Deny once"]);
		expect(result).toBeUndefined();
	});

	it("always allow updates config and allows current command", async () => {
		await setRuleActions(["git.push.force"], "ask", agentDir);
		const { handlers, ctx } = createMock(agentDir);
		ctx.ui.select.mockResolvedValue("Always allow git.push.force");
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "bash", input: { command: "git -C repo push --force" } }, ctx);
		const raw = JSON.parse(await readFile(getConfigPath(agentDir), "utf8"));
		expect(result).toBeUndefined();
		expect(raw.rules["git.push.force"]).toBe("allow");
	});

	it("always deny updates config and blocks current command", async () => {
		await setRuleActions(["git.push.force"], "ask", agentDir);
		const { handlers, ctx } = createMock(agentDir);
		ctx.ui.select.mockResolvedValue("Always deny git.push.force");
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "bash", input: { command: "git push origin +main" } }, ctx);
		const raw = JSON.parse(await readFile(getConfigPath(agentDir), "utf8"));
		expect(result).toEqual(expect.objectContaining({ block: true }));
		expect(raw.rules["git.push.force"]).toBe("deny");
	});

	it("no UI ask blocks", async () => {
		const { handlers, ctx } = createMock(agentDir);
		ctx.hasUI = false;
		const result = await handlers.get("tool_call")!({ type: "tool_call", toolName: "bash", input: { command: "git status --porcelain=$FORMAT" } }, ctx);
		expect(result).toEqual(expect.objectContaining({ block: true }));
		expect(ctx.ui.select).not.toHaveBeenCalled();
	});

	it("/safety-mode readonly persists mode and updates status", async () => {
		const { commands, ctx } = createMock(agentDir);
		await commands.get("safety-mode").handler("readonly", ctx);
		const raw = JSON.parse(await readFile(getConfigPath(agentDir), "utf8"));
		expect(raw.mode).toBe("readonly");
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-safety-modes", "safety:readonly");
	});

	it("/safety-mode legacy aliases persist canonical modes", async () => {
		const { commands, ctx } = createMock(agentDir);
		await commands.get("safety-mode").handler("protected", ctx);
		let raw = JSON.parse(await readFile(getConfigPath(agentDir), "utf8"));
		expect(raw.mode).toBe("blocklist");
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-safety-modes", "safety:blocklist");

		await commands.get("safety-mode").handler("unrestricted", ctx);
		raw = JSON.parse(await readFile(getConfigPath(agentDir), "utf8"));
		expect(raw.mode).toBe("off");
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-safety-modes", "safety:off");
	});
});
