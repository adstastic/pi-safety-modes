const shellNames = new Set(["bash", "sh", "zsh", "fish"]);

export function classifyArgv(argv: string[]): string[] {
	if (argv.length === 0) return [];
	if (isOpaqueWrapper(argv)) return ["shell.opaque"];

	const command = basename(argv[0]);
	if (command === "git") return classifyGit(argv.slice(1));

	switch (command) {
		case "ls":
		case "pwd":
			return ["fs.list"];
		case "cat":
		case "head":
		case "tail":
		case "less":
		case "more":
			return ["fs.read"];
		case "grep":
		case "rg":
		case "ag":
			return ["search.grep"];
		case "find":
			return classifyFind(argv.slice(1));
		case "rm":
		case "rmdir":
		case "unlink":
			return ["fs.delete"];
		case "mv":
			return ["fs.move"];
		case "cp":
			return ["fs.copy"];
		case "chmod":
			return ["fs.chmod"];
		case "chown":
			return ["fs.chown"];
		default:
			return ["unknown"];
	}
}

export function isShellCommand(argv: string[]): boolean {
	return argv.length > 0 && shellNames.has(basename(argv[0]));
}

function isOpaqueWrapper(argv: string[]): boolean {
	const cmd = basename(argv[0]);
	if ((shellNames.has(cmd) && argv.includes("-c")) || cmd === "eval" || cmd === "source" || cmd === ".") return true;
	if (cmd !== "xargs") return false;
	for (let i = 1; i < argv.length - 1; i++) {
		if (shellNames.has(basename(argv[i])) && argv.slice(i + 1).includes("-c")) return true;
	}
	return false;
}

function classifyGit(args: string[]): string[] {
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === "-C" || arg === "-c" || arg === "--git-dir" || arg === "--work-tree") i += 2;
		else if (arg === "--no-pager" || arg.startsWith("-C") || arg.startsWith("-c")) i += 1;
		else if (arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=")) i += 1;
		else if (arg.startsWith("-")) i += 1;
		else break;
	}

	const subcommand = args[i];
	const rest = args.slice(i + 1);
	if (!subcommand) return ["unknown"];
	const writesToOutput = rest.some((arg) => arg === "--output" || arg.startsWith("--output="));

	switch (subcommand) {
		case "status":
			return ["git.status"];
		case "diff":
			return writesToOutput ? ["unknown"] : ["git.diff"];
		case "log":
			return writesToOutput ? ["unknown"] : ["git.log"];
		case "show":
			return writesToOutput ? ["unknown"] : ["git.show"];
		case "blame":
			return ["git.blame"];
		case "grep":
			return ["git.grep"];
		case "remote":
			return classifyGitRemote(rest);
		case "branch":
			return classifyGitBranch(rest);
		case "tag":
			return classifyGitTag(rest);
		case "push":
			return classifyGitPush(rest);
		case "reset":
			return rest.includes("--hard") ? ["git.reset.hard"] : ["git.reset"];
		case "clean":
			return rest.some(isForceCleanFlag) ? ["git.clean.force"] : ["git.clean"];
		case "rebase":
			return ["git.rebase"];
		case "cherry-pick":
			return ["git.cherry-pick"];
		case "merge":
			return ["git.merge"];
		case "checkout":
			return ["git.checkout"];
		case "switch":
			return ["git.switch"];
		case "rm":
			return ["fs.delete"];
		default:
			return ["unknown"];
	}
}

function classifyGitRemote(args: string[]): string[] {
	if (args.length === 0 || args.every((a) => a === "-v" || a === "--verbose") || args[0] === "show") {
		return ["git.remote.view"];
	}
	return ["unknown"];
}

function classifyGitBranch(args: string[]): string[] {
	if (args.some((a) => a === "-d" || a === "-D" || a === "--delete")) return ["git.branch.delete"];
	const listFlags = new Set(["-a", "--all", "-r", "--remotes", "--list", "-l", "-v", "-vv", "--verbose"]);
	return args.every((a) => listFlags.has(a) || a.startsWith("--contains")) ? ["git.branch.list"] : ["unknown"];
}

function classifyGitTag(args: string[]): string[] {
	if (args.some((a) => a === "-d" || a === "--delete")) return ["git.tag.delete"];
	if (args.length === 0) return ["git.tag.list"];
	return args[0] === "-l" || args[0] === "--list" ? ["git.tag.list"] : ["unknown"];
}

function classifyGitPush(args: string[]): string[] {
	const ops = new Set<string>();
	if (args.some((a) => hasShortFlag(a, "f") || a === "--force" || a.startsWith("--force-with-lease") || a.startsWith("+"))) {
		ops.add("git.push.force");
	}
	if (args.some((a) => a === "-d" || a === "--delete" || (a.startsWith(":") && a.length > 1))) {
		ops.add("git.push.delete");
	}
	return ops.size > 0 ? [...ops] : ["git.push"];
}

function hasShortFlag(arg: string, flag: string): boolean {
	return arg.startsWith("-") && !arg.startsWith("--") && arg.slice(1).includes(flag);
}

function isForceCleanFlag(arg: string): boolean {
	return arg === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg);
}

function classifyFind(args: string[]): string[] {
	const ops = new Set<string>();
	if (args.includes("-delete")) ops.add("fs.delete");

	for (let i = 0; i < args.length - 1; i++) {
		if (!isFindExecArg(args[i])) continue;
		const nested = args.slice(i + 1, findExecEnd(args, i + 1));
		if (nested.length > 0) for (const op of classifyArgv(nested)) ops.add(op);
	}

	return ops.size > 0 ? [...ops] : ["search.find"];
}

function isFindExecArg(arg: string): boolean {
	return arg === "-exec" || arg === "-execdir" || arg === "-ok" || arg === "-okdir";
}

function findExecEnd(args: string[], start: number): number {
	const end = args.findIndex((arg, index) => index >= start && (arg === ";" || arg === "+"));
	return end === -1 ? args.length : end;
}

function basename(command: string): string {
	return command.split("/").pop() ?? command;
}
