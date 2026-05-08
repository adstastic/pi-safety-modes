import { describe, expect, it } from "vitest";
import { analyzeBash } from "../src/bash-ast.js";

describe("bash AST analysis", () => {
	it("extracts argv for git status", async () => {
		const analysis = await analyzeBash("git status");
		expect(analysis.commands).toEqual([["git", "status"]]);
	});

	it("preserves git global flag argv", async () => {
		const analysis = await analyzeBash("git -C ../repo status");
		expect(analysis.commands).toEqual([["git", "-C", "../repo", "status"]]);
	});

	it("extracts commands separated by &&", async () => {
		const analysis = await analyzeBash("git status && git diff");
		expect(analysis.commands).toEqual([["git", "status"], ["git", "diff"]]);
	});

	it("extracts commands separated by semicolon", async () => {
		const analysis = await analyzeBash("git status; git reset --hard");
		expect(analysis.commands).toEqual([["git", "status"], ["git", "reset", "--hard"]]);
	});

	it("preserves commands across a non-shell pipe", async () => {
		const analysis = await analyzeBash("echo hi | grep hi");
		expect(analysis.commands).toEqual([["echo", "hi"], ["grep", "hi"]]);
		expect(analysis.pipeToShell).toBe(false);
	});

	it.each(["curl x | sh", "curl x | sudo -E sh", "curl x | /usr/bin/env sh", "curl x | command -p sh"])("detects pipe-to-shell form %s", async (command) => {
		const analysis = await analyzeBash(command);
		expect(analysis.pipeToShell).toBe(true);
		expect(analysis.ops).toContain("shell.pipe-to-shell");
	});

	it("marks truncating redirects as writes", async () => {
		const analysis = await analyzeBash("echo hi > file.txt");
		expect(analysis.writes).toBe(true);
		expect(analysis.ops).toContain("shell.redirect-write");
	});

	it("marks append redirects as writes", async () => {
		const analysis = await analyzeBash("echo hi >> file.txt");
		expect(analysis.writes).toBe(true);
	});

	it("does not extract fake commands from heredoc content", async () => {
		const analysis = await analyzeBash("cat <<EOF\nrm -rf /\nEOF");
		expect(analysis.commands).toEqual([["cat"]]);
	});

	it("ignores comments", async () => {
		const analysis = await analyzeBash("# comment\ngit status # trailing");
		expect(analysis.commands).toEqual([["git", "status"]]);
	});

	it("preserves quoted args enough for classification", async () => {
		const analysis = await analyzeBash('git commit -m "hello world"');
		expect(analysis.commands).toEqual([["git", "commit", "-m", "hello world"]]);
	});

	it("normalizes backslash-escaped force push flags", async () => {
		const analysis = await analyzeBash("git push --force\\-with-lease");
		expect(analysis.commands).toEqual([["git", "push", "--force-with-lease"]]);
		expect(analysis.ops).toContain("git.push.force");
	});

	it("classifies quoted force push flags", async () => {
		expect((await analyzeBash('git push "--force"')).ops).toContain("git.push.force");
		expect((await analyzeBash("git push '--force'")).ops).toContain("git.push.force");
	});

	it("marks expansion-containing arguments opaque", async () => {
		const forceLike = await analyzeBash("git push --for$Xe");
		expect(forceLike.ops).toContain("shell.opaque");

		const status = await analyzeBash("git status --porcelain=$FORMAT");
		expect(status.ops).toContain("shell.opaque");
	});

	it.each(["env -Sbash\\ -c\\ rm\\ file", "env -vS 'bash -c rm file'"])("marks env split-string shell exec opaque: %s", async (command) => {
		const analysis = await analyzeBash(command);
		expect(analysis.ops).toContain("shell.exec");
		expect(analysis.ops).toContain("shell.opaque");
	});
});
