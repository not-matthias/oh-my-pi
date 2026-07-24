export function preloadToolModules(): void {
	void Promise.all([
		import("./tools/ast-grep"),
		import("./tools/ast-edit"),
		import("./tools/ask"),
		import("./tools/debug"),
		import("./tools/eval"),
		import("./tools/gh"),
		import("./lsp"),
		import("./tools/inspect-image"),
		import("./tools/browser"),
		import("./tools/checkpoint"),
		import("./tools/todo"),
		import("./tools/memory-edit"),
		import("./tools/memory-retain"),
		import("./tools/memory-recall"),
		import("./tools/memory-reflect"),
		import("./tools/learn"),
		import("./tools/manage-skill"),
	]).catch(() => {});
}
