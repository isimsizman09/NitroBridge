/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * See LICENSE file for more information
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
