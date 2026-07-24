/**
 * Lightweight mutable theme state used by settings hooks.
 *
 * This module intentionally has NO heavy imports — no theme JSONs, no chalk,
 * no arktype, no pi-tui. It provides synchronous state setters that
 * settings.ts needs without pulling the full theme system into the startup
 * module-evaluation critical path.
 *
 * The actual theme object (Theme) is constructed lazily by initTheme() in
 * theme.ts; these variables bridge the gap between early setting application
 * (e.g. fireAllHooks after loading config.yml) and the first render.
 */

export let autoDarkTheme = "dark";
export let autoLightTheme = "light";
export let currentSymbolPresetOverride: "ascii" | "unicode" | "nerd" | undefined;
export let currentColorBlindMode = false;

export function setAutoThemeMapping(mode: "dark" | "light", themeName: string): void {
	if (mode === "dark") autoDarkTheme = themeName;
	else autoLightTheme = themeName;
}

export function setSymbolPresetOverride(preset: typeof currentSymbolPresetOverride): void {
	currentSymbolPresetOverride = preset;
}

export function setColorBlindModeOverride(enabled: boolean): void {
	currentColorBlindMode = enabled;
}
