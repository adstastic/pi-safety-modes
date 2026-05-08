const shellNames = new Set(["bash", "sh", "zsh", "fish"]);
const maxWrapperDepth = 8;

export function classifyArgv(argv: string[]): string[] {
	return classifyArgvInner(argv, 0);
}

function classifyArgvInner(argv: string[], depth: number): string[] {
	if (argv.length === 0) return [];
	if (depth > maxWrapperDepth) return ["unknown"];
	if (isOpaqueShell(argv)) return ["shell.opaque"];
	if (isOpaqueEnvSplit(argv)) return ["shell.opaque"];

	const unwrapped = unwrapWrapper(argv);
	if (unwrapped) return classifyArgvInner(unwrapped, depth + 1);

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
		case "rsync":
			return ["fs.copy"];
		case "chmod":
			return ["fs.chmod"];
		case "chown":
			return ["fs.chown"];
		case "mkdir":
		case "touch":
		case "tee":
		case "install":
		case "ln":
		case "truncate":
		case "dd":
			return ["fs.write"];
		case "sed":
			return argv.slice(1).some((arg) => arg === "-i" || arg.startsWith("-i")) ? ["fs.write"] : ["unknown"];
		default:
			return ["unknown"];
	}
}

export function isShellCommand(argv: string[]): boolean {
	return isShellCommandInner(argv, 0);
}

function isShellCommandInner(argv: string[], depth: number): boolean {
	if (argv.length === 0 || depth > maxWrapperDepth) return false;
	if (shellNames.has(basename(argv[0]))) return true;
	const unwrapped = unwrapWrapper(argv);
	return unwrapped ? isShellCommandInner(unwrapped, depth + 1) : false;
}

function isOpaqueShell(argv: string[]): boolean {
	const cmd = basename(argv[0]);
	return (shellNames.has(cmd) && argv.includes("-c")) || cmd === "eval" || cmd === "source" || cmd === ".";
}

function isOpaqueEnvSplit(argv: string[]): boolean {
	const cmd = basename(argv[0]);
	return cmd === "env" && argv.slice(1).some(isEnvSplitOption);
}

function isEnvSplitOption(arg: string): boolean {
	if (arg === "-S" || arg === "--split-string" || arg.startsWith("--split-string=")) return true;
	return arg.startsWith("-") && !arg.startsWith("--") && arg.slice(1).includes("S");
}

function unwrapWrapper(argv: string[]): string[] | undefined {
	const cmd = basename(argv[0]);
	switch (cmd) {
		case "sudo":
		case "doas":
			return unwrapOptionWrapper(argv.slice(1), sudoOptionsWithValue);
		case "env":
			return unwrapEnv(argv.slice(1));
		case "command":
			return unwrapCommand(argv.slice(1));
		case "time":
			return unwrapOptionWrapper(argv.slice(1), new Set());
		case "timeout":
			return unwrapTimeout(argv.slice(1));
		case "nice":
			return unwrapNice(argv.slice(1));
		case "nohup":
			return argv.length > 1 ? argv.slice(1) : undefined;
		case "xargs":
			return unwrapXargs(argv.slice(1));
		default:
			return undefined;
	}
}

const sudoOptionsWithValue = new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from", "-D", "--chdir", "-T", "--command-timeout"]);
const envOptionsWithValue = new Set(["-u", "--unset", "-C", "--chdir", "-0", "--argv0"]);
const timeoutOptionsWithValue = new Set(["-k", "--kill-after", "-s", "--signal"]);
const niceOptionsWithValue = new Set(["-n", "--adjustment"]);
const xargsOptionsWithValue = new Set(["-a", "--arg-file", "-d", "--delimiter", "-E", "--eof", "-I", "--replace", "-i", "-L", "--max-lines", "-n", "--max-args", "-P", "--max-procs", "-s", "--max-chars"]);

function unwrapOptionWrapper(args: string[], optionsWithValue: Set<string>): string[] | undefined {
	const index = skipOptions(args, optionsWithValue);
	return index < args.length ? args.slice(index) : undefined;
}

function unwrapEnv(args: string[]): string[] | undefined {
	let i = skipOptions(args, envOptionsWithValue);
	while (i < args.length && isEnvAssignment(args[i])) i++;
	return i < args.length ? args.slice(i) : undefined;
}

function unwrapCommand(args: string[]): string[] | undefined {
	if (args.some((arg) => arg === "-v" || arg === "-V")) return undefined;
	return unwrapOptionWrapper(args, new Set());
}

function unwrapTimeout(args: string[]): string[] | undefined {
	const i = skipOptions(args, timeoutOptionsWithValue);
	return i + 1 < args.length ? args.slice(i + 1) : undefined;
}

function unwrapNice(args: string[]): string[] | undefined {
	let i = skipOptions(args, niceOptionsWithValue);
	if (i < args.length && /^-\d+$/.test(args[i])) i++;
	return i < args.length ? args.slice(i) : undefined;
}

function unwrapXargs(args: string[]): string[] | undefined {
	const i = skipOptions(args, xargsOptionsWithValue);
	return i < args.length ? args.slice(i) : undefined;
}

function skipOptions(args: string[], optionsWithValue: Set<string>): number {
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === "--") return i + 1;
		if (!arg.startsWith("-") || arg === "-") break;
		const option = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
		const clusterValue = shortClusterValue(arg, optionsWithValue);
		const gluedValue = hasGluedShortValue(arg, optionsWithValue);
		const separateValue = (optionsWithValue.has(option) || clusterValue === "next") && !arg.includes("=") && !gluedValue;
		i += separateValue ? 2 : 1;
	}
	return i;
}

function hasGluedShortValue(arg: string, optionsWithValue: Set<string>): boolean {
	return shortClusterValue(arg, optionsWithValue) === "glued";
}

function shortClusterValue(arg: string, optionsWithValue: Set<string>): "glued" | "next" | undefined {
	if (!arg.startsWith("-") || arg.startsWith("--") || arg.length <= 2) return undefined;
	const valueFlags = new Set([...optionsWithValue].filter((opt) => /^-[A-Za-z0-9]$/.test(opt)).map((opt) => opt[1]));
	for (let i = 1; i < arg.length; i++) {
		if (valueFlags.has(arg[i])) return i === arg.length - 1 ? "next" : "glued";
	}
	return undefined;
}

function isEnvAssignment(arg: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg);
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
		case "add":
			return ["git.add"];
		case "commit":
			return ["git.commit"];
		case "restore":
			return ["git.restore"];
		case "stash":
			return ["git.stash"];
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
