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

// Yabdp4Nitro — per-user ignore store (clean-room rewrite).
// Inspired by YABDP4Nitro v7.0.4's IgnoreStore (OSL-3.0). No copied code.
// nitro: also hides real Nitro decor. encoding: skips hidden 3y3 codes.

import { settings } from "./settings";

export interface IgnoreFlags {
    nitro?: boolean;
    encoding?: boolean;
}

type IgnoreMap = Record<string, IgnoreFlags>;

function readAll(): IgnoreMap {
    try {
        const raw = settings.store.ignores as unknown;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
        const clean: IgnoreMap = {};
        for (const [id, flags] of Object.entries(raw as IgnoreMap)) {
            if (!/^\d+$/.test(id) || !flags || typeof flags !== "object") continue;
            clean[id] = { nitro: !!flags.nitro, encoding: !!flags.encoding };
        }
        return clean;
    } catch {
        return {};
    }
}

function writeAll(map: IgnoreMap) {
    try {
        (settings.store as any).ignores = map;
    } catch { /* ignore */ }
}

export function toggleIgnore(id: string, key: "nitro" | "encoding") {
    if (!/^\d+$/.test(id ?? "")) return;
    const all = { ...readAll() };
    const entry = { nitro: false, encoding: false, ...(all[id] ?? {}) };
    entry[key] = !entry[key];
    if (!entry.nitro && !entry.encoding) delete all[id];
    else all[id] = entry;
    writeAll(all);
}

export function isIgnored(id: string | undefined, key?: "nitro" | "encoding") {
    if (!id || !/^\d+$/.test(id)) return false;
    const entry = readAll()[id];
    if (!entry) return false;
    if (key) return !!entry[key];
    return !!(entry.nitro || entry.encoding);
}
