// NitroBridge test runner. Bare node, no dependencies.
// Suites needing npm packages (esbuild/fflate) run only when resolvable,
// otherwise they report SKIP instead of failing. Exit non-zero on any FAIL.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
let failures = 0;
let skipped = 0;

function T(name, cond) {
    if (!cond) {
        console.error("FAIL: " + name);
        failures++;
    } else {
        console.log("ok: " + name);
    }
}

function tryResolve(mod) {
    for (const base of [ROOT, process.cwd(), __dirname]) {
        try {
            return require.resolve(mod, { paths: [base] });
        } catch { /* next */ }
    }
    return null;
}

// ---- Suite 1: FFmpeg pins (always runs: fs + webcrypto only) ----
(function hashSuite() {
    const src = fs.readFileSync(path.join(ROOT, "yabdp4Nitro", "ffmpeg.ts"), "utf8");
    T("commit-sha", /const FFMPEG_COMMIT = "[0-9a-f]{40}";/.test(src));
    for (const n of ["ffmpeg.js", "814.ffmpeg.js", "ffmpeg-core.js", "ffmpeg-core.wasm"]) {
        const m = src.match(new RegExp('"' + n.replace(/\./g, "\\.") + '": "([0-9a-f]+)"'));
        T("hash-" + n, !!m && m[1].length === 64 && /^[0-9a-f]{64}$/.test(m[1]));
    }
    T("fail-closed", /refusing to run/.test(src) && !/continuing anyway/.test(src));
    T("worker-gate", /if \(!EXPECTED_HASHES\[workerName\]\) throw/.test(src));
})();

// ---- Suite 2: pure-logic suites (need esbuild + fflate) ----
(function logicSuites() {
    const esbuildPath = tryResolve("esbuild");
    const fflatePath = tryResolve("fflate");
    if (!esbuildPath || !fflatePath) {
        console.log("SKIP: logic suites (run inside a Vencord checkout: node tests/run.js there)");
        skipped++;
        return;
    }
    const esbuild = require(esbuildPath);
    // Bundle next to the checkout's node_modules so bare imports (fflate) resolve.
    const outDir = process.cwd();
    const canLink = (() => { try { require.resolve("fflate", { paths: [outDir] }); return true; } catch { return false; } })();
    if (!canLink) {
        console.log("SKIP: logic suites (run inside a Vencord checkout: node tests/run.js there)");
        skipped++;
        return;
    }
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nitrobridge-"));
    try {
        for (const f of ["clips.ts", "profile.ts"]) {
            esbuild.buildSync({
                entryPoints: [path.join(ROOT, "yabdp4Nitro", f)],
                outfile: path.join(outDir, `.nitrobridge-${f}.cjs`),
                format: "cjs",
                platform: "node",
                bundle: true,
                external: ["fflate"],
                logLevel: "error"
            });
        }
        const c = require(path.join(outDir, ".nitrobridge-clips.ts.cjs"));
        const p = require(path.join(outDir, ".nitrobridge-profile.ts.cjs"));
        const MB = 1048576;
        const O = { video: true, forceClip: false, audio: true, forceAudio: false, zip: true };
        T("v-big", c.decideClip({ name: "a.mp4", size: 50 * MB, type: "video/mp4" }, O) === "video");
        T("v-small", c.decideClip({ name: "a.mp4", size: 5 * MB, type: "video/mp4" }, O) === "skip");
        T("img-small", c.decideClip({ name: "a.png", size: 1024, type: "image/png" }, O) === "skip");
        T("case-insensitive", c.decideClip({ name: "A.MP4", size: 50 * MB, type: "VIDEO/MP4" }, O) === "video");
        T("blacklist", c.decideClip({ name: "a.mpeg", size: 50 * MB, type: "video/mpeg" }, O) === "skip");
        T("zipname", c.clipFileName("d.txt", "zip") === "d.zip.mp4");
        T("archname", c.clipFileName("d.zip", "zip") === "d.zip.mp4");
        T("tag", (() => { const t = c.buildClipTag("1", "f.mp4", 100, 1700000000000, 2); return t.createdAt === 1700000000000 && typeof t.id === "bigint"; })());
        T("photo", p.photoOf("x" + p.makePhotoCode("AbC12")) === "https://i.imgur.com/AbC12.gif");
        T("fps", JSON.stringify(p.extraFpsValues(-1)) === "[90,120,144,180,240]");
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
        for (const f of [".nitrobridge-clips.ts.cjs", ".nitrobridge-profile.ts.cjs"]) {
            try { fs.unlinkSync(path.join(outDir, f)); } catch { /* ignore */ }
        }
    }
})();

// ---- Suite 3: sha256 known vector (always runs) ----
crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc")).then(d => {
    const hex = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
    T("sha256-vector", hex === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    console.log(failures ? "SUITE FAIL" : `suite ok${skipped ? ` (${skipped} skipped)` : ""}`);
    process.exit(failures ? 1 : 0);
});
