/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 *
 * NOTE: intentionally not the Vencord GPL header (this is OSL-3.0 code);
 * run eslint WITHOUT --fix on this folder.
 */

// Language helpers. The plugin is English-first: Turkish strings are only
// used when Discord itself runs in Turkish. No language setting needed.

import { LocaleStore, UserSettingsProtoStore } from "@webpack/common";

export function discordLocale(): string {
    try {
        const l = (LocaleStore as any)?.locale;
        if (typeof l === "string" && l) return l;
    } catch { /* fall through */ }
    try {
        const v = (UserSettingsProtoStore as any)?.settings?.localization?.locale?.value;
        if (typeof v === "string" && v) return v;
    } catch { /* fall through */ }
    return "en-US";
}

export function isTurkish(): boolean {
    try {
        return discordLocale().toLowerCase().startsWith("tr");
    } catch {
        return false;
    }
}

// Pick a UI string by Discord language. Option descriptions use this through
// getters so they resolve when the settings screen renders, not at load.
export function T(tr: string, en: string): string {
    return isTurkish() ? tr : en;
}
