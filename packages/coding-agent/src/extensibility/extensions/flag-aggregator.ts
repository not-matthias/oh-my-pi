import type { ExtensionFlag } from "./types";

export function aggregateExtensionFlags(
	extensions: readonly { flags: Map<string, ExtensionFlag> }[],
): Map<string, ExtensionFlag> {
	const allFlags = new Map<string, ExtensionFlag>();
	for (const ext of extensions) {
		for (const [name, flag] of ext.flags) {
			allFlags.set(name, flag);
		}
	}
	return allFlags;
}
