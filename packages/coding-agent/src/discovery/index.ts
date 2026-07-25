/**
 * Discovery Module
 *
 * Auto-registers all providers by importing them.
 * Import this module to ensure all providers are registered with the capability registry.
 */
// Import capability definitions (ensures capabilities are defined before providers register)
import "../capability/context-file";
import "../capability/extension";
import "../capability/extension-module";
import "../capability/hook";
import "../capability/instruction";
import "../capability/mcp";
import "../capability/prompt";
import "../capability/rule";
import "../capability/settings";
import "../capability/skill";
import "../capability/slash-command";
import "../capability/ssh";
import "../capability/system-prompt";
import "../capability/tool";
// Import providers. Each provider self-registers via registerProvider() as a
// module side-effect. The three MUST-stay-eager providers (builtin/native,
// builtin-defaults, agents-md) are commonly used and cheap, so they import
// directly. The remaining ~14 providers are registered lazily: their module
// imports (and the heavy transitive chains they pull in — TOML parsers, SDK
// clients, plugin resolvers, …) are deferred until the first loadCapability()
// call via ensureLazyModulesLoaded(). This keeps `import "./discovery"` cheap
// at startup; providers only load when the capability system is actually used.
//
// NOTE on dynamic import(): AGENTS.md says "NEVER use inline imports", which
// forbids *eager* inline imports used as a substitute for top-level static
// imports (they bypass the bundler's dependency graph and defeat tree-shaking).
// The lazy loaders here are different: they are *deferred* dynamic imports
// wrapped in a thunk and only invoked by ensureLazyModulesLoaded() at
// loadCapability() time. A static import cannot achieve this deferral — it
// evaluates the module (and its full transitive import chain) at
// discovery/index.ts load time, which is exactly the startup cost we are
// eliminating. The codebase already uses the same `await import()` pattern
// for branch-only modules (rpc-mode, print-mode, export/html, setup-wizard).
import { registerLazyModule } from "../capability";
import "./agents-md";
import "./builtin";
import "./builtin-defaults";

registerLazyModule(
	() => import("./claude"),
	[
		"mcps",
		"context-files",
		"skills",
		"extension-modules",
		"slash-commands",
		"hooks",
		"tools",
		"settings",
		"system-prompt",
	],
);
registerLazyModule(() => import("./claude-plugins"), ["skills", "slash-commands", "hooks", "tools", "mcps"]);
registerLazyModule(() => import("./cline"), ["rules"]);
registerLazyModule(
	() => import("./agents"),
	["skills", "rules", "prompts", "slash-commands", "context-files", "system-prompt"],
);
registerLazyModule(
	() => import("./codex"),
	["context-files", "mcps", "skills", "extension-modules", "slash-commands", "prompts", "hooks", "tools", "settings"],
);
registerLazyModule(() => import("./cursor"), ["mcps", "rules", "settings"]);
registerLazyModule(
	() => import("./gemini"),
	["mcps", "context-files", "system-prompt", "extensions", "extension-modules", "settings"],
);
registerLazyModule(
	() => import("./opencode"),
	["context-files", "mcps", "skills", "extension-modules", "slash-commands", "settings"],
);
registerLazyModule(() => import("./github"), ["context-files", "instructions", "rules", "skills", "prompts"]);
registerLazyModule(() => import("./mcp-json"), ["mcps"]);
registerLazyModule(
	() => import("./omp-plugins"),
	["skills", "slash-commands", "rules", "prompts", "hooks", "tools", "mcps"],
);
registerLazyModule(() => import("./ssh"), ["ssh"]);
registerLazyModule(() => import("./vscode"), ["mcps"]);
registerLazyModule(() => import("./windsurf"), ["mcps", "rules"]);

// Re-export the main API from capability registry
export {
	cacheStats,
	// Provider management
	disableProvider,
	enableProvider,
	getAllCapabilitiesInfo,
	getAllProvidersInfo,
	// Introspection
	getCapability,
	getCapabilityInfo,
	getDisabledProviders,
	getProviderInfo,
	// Initialization
	initializeWithSettings,
	invalidate,
	isProviderEnabled,
	listCapabilities,
	// Loading API
	loadCapability,
	// Cache management
	reset,
	setDisabledProviders,
} from "../capability";
export type { ContextFile } from "../capability/context-file";
export type { Extension, ExtensionManifest } from "../capability/extension";
export type { ExtensionModule } from "../capability/extension-module";
export type { Hook } from "../capability/hook";
export type { Instruction } from "../capability/instruction";
// Re-export capability item types
export type { MCPServer } from "../capability/mcp";
export type { Prompt } from "../capability/prompt";
export type { Rule, RuleFrontmatter } from "../capability/rule";
export type { Settings } from "../capability/settings";
export type { Skill, SkillFrontmatter } from "../capability/skill";
export type { SlashCommand } from "../capability/slash-command";
export type { SSHHost } from "../capability/ssh";
export type { SystemPrompt } from "../capability/system-prompt";
export type { CustomTool } from "../capability/tool";
// Re-export types
export type * from "../capability/types";
