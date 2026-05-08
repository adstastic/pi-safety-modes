import { describe, expect, it } from "vitest";
import { analyzeBash } from "../src/bash-ast.js";
import { classifyArgv } from "../src/classify.js";

const cases: Array<[string[], string[]]> = [
	[["git", "status"], ["git.status"]],
	[["git", "-C", "repo", "status"], ["git.status"]],
	[["git", "diff", "--", "src"], ["git.diff"]],
	[["git", "log"], ["git.log"]],
	[["git", "show"], ["git.show"]],
	[["git", "blame", "file"], ["git.blame"]],
	[["git", "grep", "x"], ["git.grep"]],
	[["git", "remote", "-v"], ["git.remote.view"]],
	[["git", "remote", "show", "origin"], ["git.remote.view"]],
	[["git", "branch"], ["git.branch.list"]],
	[["git", "branch", "-a"], ["git.branch.list"]],
	[["git", "branch", "-d", "old"], ["git.branch.delete"]],
	[["git", "branch", "-D", "old"], ["git.branch.delete"]],
	[["git", "branch", "--delete", "old"], ["git.branch.delete"]],
	[["git", "tag"], ["git.tag.list"]],
	[["git", "tag", "-l"], ["git.tag.list"]],
	[["git", "tag", "-d", "v1"], ["git.tag.delete"]],
	[["git", "push"], ["git.push"]],
	[["git", "push", "--force"], ["git.push.force"]],
	[["git", "push", "-f"], ["git.push.force"]],
	[["git", "push", "-uf", "origin", "main"], ["git.push.force"]],
	[["git", "push", "-fu", "origin", "main"], ["git.push.force"]],
	[["git", "push", "--force-with-lease"], ["git.push.force"]],
	[["git", "push", "--force-with-lease=main"], ["git.push.force"]],
	[["git", "push", "origin", "+main"], ["git.push.force"]],
	[["git", "push", "--delete", "origin", "branch"], ["git.push.delete"]],
	[["git", "push", "origin", ":branch"], ["git.push.delete"]],
	[["git", "reset", "--hard"], ["git.reset.hard"]],
	[["git", "clean", "-f"], ["git.clean.force"]],
	[["git", "clean", "-fd"], ["git.clean.force"]],
	[["git", "rebase"], ["git.rebase"]],
	[["git", "cherry-pick", "abc"], ["git.cherry-pick"]],
	[["git", "merge", "main"], ["git.merge"]],
	[["git", "checkout", "main"], ["git.checkout"]],
	[["git", "switch", "main"], ["git.switch"]],
	[["git", "add", "file"], ["git.add"]],
	[["git", "commit", "-m", "msg"], ["git.commit"]],
	[["git", "restore", "file"], ["git.restore"]],
	[["git", "stash"], ["git.stash"]],
	[["git", "rm", "file"], ["fs.delete"]],
	[["ls"], ["fs.list"]],
	[["pwd"], ["fs.list"]],
	[["cat", "file"], ["fs.read"]],
	[["grep", "x", "file"], ["search.grep"]],
	[["rg", "x"], ["search.grep"]],
	[["find", ".", "-name", "x"], ["search.find"]],
	[["find", ".", "-delete"], ["fs.delete"]],
	[["find", ".", "-exec", "rm", "{}", ";"], ["fs.delete"]],
	[["git", "diff", "--output=file"], ["unknown"]],
	[["rm", "x"], ["fs.delete"]],
	[["unlink", "x"], ["fs.delete"]],
	[["mv", "a", "b"], ["fs.move"]],
	[["cp", "a", "b"], ["fs.copy"]],
	[["rsync", "a", "b"], ["fs.copy"]],
	[["touch", "x"], ["fs.write"]],
	[["tee", "x"], ["fs.write"]],
	[["install", "a", "b"], ["fs.write"]],
	[["sed", "-i", "s/a/b/", "x"], ["fs.write"]],
	[["chmod", "600", "x"], ["fs.chmod"]],
	[["chown", "me", "x"], ["fs.chown"]],
	[["nope"], ["unknown"]],
	[["bash", "-c", "git push --force"], ["shell.exec", "shell.opaque"]],
	[["eval", "git", "status"], ["shell.exec", "shell.opaque"]],
	[["sh", "-c", "rm -rf x"], ["shell.exec", "shell.opaque"]],
	[["alias", "x=rm file"], ["shell.exec", "shell.opaque"]],
	[["sudo", "rm", "x"], ["fs.delete"]],
	[["sudo", "-E", "rm", "x"], ["fs.delete"]],
	[["sudo", "-u", "root", "rm", "x"], ["fs.delete"]],
	[["sudo", "-Eu", "root", "rm", "x"], ["fs.delete"]],
	[["sudo", "-Hiu", "root", "rm", "x"], ["fs.delete"]],
	[["sudo", "-uroot", "rm", "x"], ["fs.delete"]],
	[["env", "rm", "x"], ["fs.delete"]],
	[["/usr/bin/env", "PATH=/bin", "rm", "x"], ["fs.delete"]],
	[["command", "rm", "x"], ["fs.delete"]],
	[["command", "-p", "rm", "x"], ["fs.delete"]],
	[["time", "rm", "x"], ["fs.delete"]],
	[["timeout", "5", "rm", "x"], ["fs.delete"]],
	[["nice", "-n", "5", "rm", "x"], ["fs.delete"]],
	[["nohup", "rm", "x"], ["fs.delete"]],
	[["xargs", "rm"], ["fs.delete"]],
	[["xargs", "-0", "rm", "-f"], ["fs.delete"]],
	[["sudo", "bash", "-c", "git reset --hard"], ["shell.exec", "shell.opaque"]],
	[["env", "bash", "-c", "git reset --hard"], ["shell.exec", "shell.opaque"]],
	[["env", "-Sbash -c rm file"], ["shell.exec", "shell.opaque"]],
	[["env", "-vS", "bash -c rm file"], ["shell.exec", "shell.opaque"]],
	[["xargs", "sh", "-c", "echo"], ["shell.exec", "shell.opaque"]],
];

describe("command classifier", () => {
	it.each(cases)("classifies %j", (argv, expected) => {
		expect(classifyArgv(argv)).toEqual(expected);
	});

	it("detects pipe to shell from bash syntax", async () => {
		const analysis = await analyzeBash("curl x | sh");
		expect(analysis.pipeToShell).toBe(true);
		expect(analysis.ops).toContain("shell.pipe-to-shell");
	});

	it("detects opaque shell wrappers from bash syntax", async () => {
		const analysis = await analyzeBash('bash -c "git push --force"');
		expect(analysis.opaque).toBe(true);
		expect(analysis.ops).toContain("shell.opaque");
		expect(analysis.ops).toContain("shell.exec");
	});
});
