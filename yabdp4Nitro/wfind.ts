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

// Late-bound webpack lookup by module source (minified names shift builds).

import { wreq } from "@webpack";

export function factorySource(fn: unknown): string {
    try {
        return Function.prototype.toString.call(fn);
    } catch {
        return "";
    }
}

// First loaded module whose factory mentions every needle, or null.
export function findModuleByNeedles(needles: string[]): any {
    try {
        const factories = (wreq as any)?.m;
        if (!factories) return null;
        let hits = 0;
        let found: any = null;
        for (const id of Object.keys(factories)) {
            let code = "";
            try {
                code = factorySource(factories[id]);
            } catch {
                continue;
            }
            if (!needles.every(n => code.includes(n))) continue;
            let mod: any = null;
            try {
                mod = (wreq as any)(id);
            } catch {
                continue;
            }
            hits++;
            if (hits > 1) {
                try {
                    console.warn("[Yabdp4Nitro] ambiguous module match, using first");
                } catch { /* ignore */ }
                break;
            }
            found = mod;
        }
        return found;
    } catch { /* ignore */ }
    return null;
}
