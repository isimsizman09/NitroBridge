/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
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
        for (const id of Object.keys(factories)) {
            let code = "";
            try {
                code = factorySource(factories[id]);
            } catch {
                continue;
            }
            if (!needles.every(n => code.includes(n))) continue;
            try {
                return (wreq as any)(id);
            } catch {
                continue;
            }
        }
    } catch { /* ignore */ }
    return null;
}
