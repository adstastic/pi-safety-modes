import { createRequire } from "node:module";
import { Language, Parser, type Node } from "web-tree-sitter";
import { classifyArgv, isShellCommand } from "./classify.js";
import type { BashAnalysis } from "./types.js";

const require = createRequire(import.meta.url);
const bashWasmPath = require.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
let languagePromise: Promise<Language> | undefined;

export async function analyzeBash(command: string): Promise<BashAnalysis> {
	const language = await getLanguage();
	const parser = new Parser();
	parser.setLanguage(language);
	const tree = parser.parse(command);
	if (!tree) {
		parser.delete();
		return { commands: [], ops: ["shell.opaque"], opaque: true, writes: false, pipeToShell: false, parseError: "Bash parse failed" };
	}

	try {
		const commands: string[][] = [];
		let writes = false;
		let pipeToShell = false;
		let hasExpansion = false;

		function visit(node: Node): void {
			if (node.type === "command") {
				const command = commandToArgv(node);
				if (command.argv.length > 0) commands.push(command.argv);
				if (command.hasExpansion) hasExpansion = true;
			} else if (node.type === "file_redirect" && isWriteRedirect(node)) writes = true;
			else if (node.type === "pipeline" && pipelineToShell(node)) pipeToShell = true;

			for (const child of node.namedChildren) visit(child);
		}

		visit(tree.rootNode);
		const ops = unique(commands.flatMap(classifyArgv));
		if (writes) ops.push("shell.redirect-write");
		if (pipeToShell) ops.push("shell.pipe-to-shell");
		if (hasExpansion) ops.push("shell.opaque");
		const opaque = ops.includes("shell.opaque");

		return {
			commands,
			ops: unique(ops),
			opaque,
			writes,
			pipeToShell,
			parseError: tree.rootNode.hasError ? "Bash parse error" : undefined,
		};
	} finally {
		tree.delete();
		parser.delete();
	}
}

async function getLanguage(): Promise<Language> {
	languagePromise ??= (async () => {
		await Parser.init();
		return Language.load(bashWasmPath);
	})();
	return languagePromise;
}

interface CommandArgv {
	argv: string[];
	hasExpansion: boolean;
}

const expansionNodeTypes = new Set(["simple_expansion", "expansion", "command_substitution", "arithmetic_expansion"]);

function commandToArgv(node: Node): CommandArgv {
	const name = node.childForFieldName("name");
	if (!name) return { argv: [], hasExpansion: false };
	const args = [name, ...node.childrenForFieldName("argument")];
	return {
		argv: args.map(argText).filter(Boolean),
		hasExpansion: args.some(hasShellExpansion),
	};
}

function argText(node: Node): string {
	if (node.type === "command_name") return node.namedChildren[0] ? argText(node.namedChildren[0]) : node.text;
	if (node.type === "word") return unescapeBareWord(node.text);
	if (node.type === "raw_string" && node.text.length >= 2) return node.text.slice(1, -1);
	if (node.type === "string" || node.type === "concatenation") return node.namedChildren.map(argText).join("");
	return node.text;
}

function hasShellExpansion(node: Node): boolean {
	if (node.type === "raw_string") return false;
	return expansionNodeTypes.has(node.type) || node.namedChildren.some(hasShellExpansion);
}

function unescapeBareWord(text: string): string {
	return text.replace(/\\\n/g, "").replace(/\\(.)/gs, "$1");
}

function isWriteRedirect(node: Node): boolean {
	const token = node.children.find((child) => !child.isNamed && child.type !== "<")?.type;
	return token === ">" || token === ">>" || token === ">&" || token === "&>" || token === "&>>" || token === ">|";
}

function pipelineToShell(node: Node): boolean {
	const stages = node.namedChildren.map(firstCommandArgv).filter((argv): argv is string[] => !!argv);
	return stages.slice(1).some(isShellSink);
}

function firstCommandArgv(node: Node): string[] | undefined {
	if (node.type === "command") return commandToArgv(node).argv;
	for (const child of node.namedChildren) {
		const found = firstCommandArgv(child);
		if (found) return found;
	}
	return undefined;
}

function isShellSink(argv: string[]): boolean {
	if (isShellCommand(argv)) return true;
	if (argv[0] === "sudo" && argv[1] && isShellCommand([argv[1]])) return true;
	return argv[0] === "env" && argv.some((arg) => isShellCommand([arg]));
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}
