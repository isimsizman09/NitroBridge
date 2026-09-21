/*
 * NitroBridge — Vencord port of YABDP4Nitro.
 * Copyright (c) 2026 isimsizman09
 * Inspired by YABDP4Nitro by Riolubruh (OSL-3.0, https://github.com/riolubruh/YABDP4Nitro).
 * Licensed under the Open Software License version 3.0 (OSL-3.0).
 * See LICENSE file for more information.
 */

// Ready-made collectible IDs for the profile-code screen, so users don't
// have to hunt down numbers themselves. Every entry below was verified
// against Discord's CDN before being added:
//   - avatar decorations / nameplates: HTTP 200 on
//     cdn.discordapp.com/media/v1/collectibles-shop/{sku}/static
//   - profile effects: HTTP 200 on their thumbnailPreviewSrc
// Names come from Discord's own shop listings. If Discord ever removes an
// item, its preview simply won't load — the code buttons keep working and
// Discord quietly ignores unknown IDs (same as a hand-typed number).

export interface DecoPreset {
    sku: string;
    name: string;
}

export interface EffectPreset {
    sku: string;
    name: string;
    thumb: string;
}

export interface PlatePreset {
    sku: string;
    palette: string;
    name: string;
}

export interface ThemePreset {
    c1: string;
    c2: string;
    name: string;
}

// Live preview for any typed-in ID (decorations, frames, nameplates).
// Profile effects don't resolve through this path, so the effect row
// relies on the curated gallery below instead.
export function shopStaticUrl(sku: string): string {
    return `https://cdn.discordapp.com/media/v1/collectibles-shop/${sku.trim()}/static`;
}

// Users often paste a full shop link instead of a bare number.
// Pull the long digit run out so pasting a link just works.
export function extractSkuId(input: string | undefined): string {
    if (!input) return "";
    const m = input.match(/\d{10,32}/);
    return m ? m[0] : input;
}

export const DECOR_PRESETS: DecoPreset[] = [
    { sku: "1212569433839636530", name: "Cat Ears" },
    { sku: "1157407831348228141", name: "Fox Hat" },
    { sku: "1157407831348228139", name: "Frog Hat" },
    { sku: "1144307629225672846", name: "Starry Eyed" },
    { sku: "1212570343567261736", name: "Heartbloom" },
    { sku: "1207047014769234001", name: "Fire" },
    { sku: "1207047597294886923", name: "Water" },
    { sku: "1207048289610899526", name: "Lightning" },
    { sku: "1197344326133502032", name: "Glitch" },
    { sku: "1212569856189407352", name: "Ki Energy" },
    { sku: "1144048977138946230", name: "Glowing Runes" },
    { sku: "1144003752978829455", name: "Flaming Sword" },
];

export const EFFECT_PRESETS: EffectPreset[] = [
    { sku: "1139323101008642101", name: "Shuriken Strike", thumb: "https://cdn.discordapp.com/assets/content/243d4fe281e83b6f7193c56322607cd4ba6c87c63b0fb9642adf2cb91da5a791" },
    { sku: "1202061726212947968", name: "Dragon Dance", thumb: "https://cdn.discordapp.com/assets/content/4ab8c8bb4b8a921e6350c019fbf21f0b92452139d8d4447834e3b92b99b83108" },
    { sku: "1139323098370424932", name: "Boost Relic", thumb: "https://cdn.discordapp.com/assets/content/5699f6cc98b986d671478ca70c5942b8d7fa22f41d366f7d60cccea92ef91b4f" },
    { sku: "1139323103193878569", name: "Cyberspace", thumb: "https://cdn.discordapp.com/assets/content/3f62a90f9288e62fbffb7181fb5ee1c0d72feeae389da03a59cc001985e8750f" },
    { sku: "1139323092645183591", name: "Hydro Blast", thumb: "https://cdn.discordapp.com/assets/content/ecb46ee798c59a66d2b563cf60bac49aa1e07bda5a676813d7508a07ba5cc909" },
    { sku: "1139323100568244355", name: "Magic Hearts", thumb: "https://cdn.discordapp.com/assets/content/21f6a1bd12d3f80fc379f4426ec1f64c8c85cfdf8af118cf4393dedcc9a8bea3" },
    { sku: "1139323093551165533", name: "Shatter", thumb: "https://cdn.discordapp.com/assets/content/aaef2ab628a692aed494a23d4f4b0d536948ed39b690101a173f7deb9833d7a3" },
    { sku: "1139323101881061466", name: "Power Surge", thumb: "https://cdn.discordapp.com/assets/content/5329f4566ae65b9c3481b0145df8e6595c9836ade6768c98f44503b8c57766ce" },
    { sku: "1212582298893946880", name: "Dreamy", thumb: "https://cdn.discordapp.com/assets/content/80f980817969963154b6b981d19fbb5eb3cbd1b06a5eacab1eb8cc0125aa480f" },
    { sku: "1212582452640350238", name: "Sushi Mania", thumb: "https://cdn.discordapp.com/assets/content/78fbe2bd3fa90e932c560d050b246973da8b02f19ca9db606df4e0cbd8b1f589" },
    { sku: "1212582372877541427", name: "Ki Detonate", thumb: "https://cdn.discordapp.com/assets/content/6f2a7ed8ef4fdad7d02aee9579fc34e62a1d43b9c83efdd354cd247360cece09" },
    { sku: "1139323093991575696", name: "Sakura Dreams", thumb: "https://cdn.discordapp.com/assets/content/7765f6bbd3a7e9e8c3e113a85b58887935bd0c9dd7947e8fde6ea953a6c5ab3c" },
];

export const PLATE_PRESETS: PlatePreset[] = [
    { sku: "1506049874590699751", palette: "cobalt", name: "Spray Doodles" },
    { sku: "1462116614131548265", palette: "white", name: "Nevermore" },
];

// Every palette Discord accepts for nameplates. Shown as a hint so users
// can try different colors with any plate number.
export const PLATE_PALETTES: string[] = [
    "cobalt", "crimson", "berry", "sky", "teal", "forest",
    "bubble_gum", "violet", "clover", "lemon", "white",
];

export const THEME_PRESETS: ThemePreset[] = [
    { c1: "5865f2", c2: "eb459e", name: "Blurple" },
    { c1: "ff9a3c", c2: "ff2e63", name: "Sunset" },
    { c1: "00c6ff", c2: "0072ff", name: "Ocean" },
    { c1: "00ffa3", c2: "00b8ff", name: "Mint" },
    { c1: "a044ff", c2: "6a5cff", name: "Grape" },
    { c1: "ff512f", c2: "dd2476", name: "Ember" },
];
