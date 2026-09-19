#!/usr/bin/env node
/*
 * _extract_workbench.js — node-only build step.
 * The workbench (fast_mover_screen.html) is a double-click dev artifact, not a
 * module, so this pulls its data constants out and writes them as JSON for the
 * Python seed path (seed_universe.py). Output is generated, not edited.
 *
 * Usage: node db/_extract_workbench.js
 *        WB_HTML=... WB_OUT=... node db/_extract_workbench.js   (overrides)
 */
const fs = require("fs");
const path = require("path");

const workbench =
  process.env.WB_HTML || path.resolve(__dirname, "../../fast_mover_screen.html");
const out = process.env.WB_OUT || path.resolve(__dirname, "_workbench_meta.json");

const src = fs.readFileSync(workbench, "utf8");

// Slice A: universe metadata lists (SHORTLIST..SCAN_EST). Pure literals.
const aStart = src.indexOf("const SHORTLIST = [");
const aEnd = src.indexOf("\nconst CORE_SIGS");
if (aStart < 0 || aEnd < 0) throw new Error("slice A anchors missing");

// Slice B: the fuzzy scoring tables (PREREV..FZ_CURVES). Pure literals.
const bStart = src.indexOf("const PREREV = new Set");
const bEnd = src.indexOf("\nfunction fzInterp");
if (bStart < 0 || bEnd < 0) throw new Error("slice B anchors missing");

const gather = new Function(
  src.slice(aStart, aEnd) +
    "\n" +
    src.slice(bStart, bEnd) +
    "\nreturn { SHORTLIST, BENCH, BENCH_V4, WIDE_BENCH, GEM_BENCH, IMAGE_ADDS, " +
    "SCAN_TIER, SCAN_EST, GROWTH, QUAL, HEAT_RULES, HAIRCUTS, FZW, FZ_CURVES, " +
    "PREREV: [...PREREV] };"
)();
// JSON has no RegExp type; the /i flag is universal across HEAT_RULES.
gather.HEAT_RULES = gather.HEAT_RULES.map(([re, v]) => [re.source, v]);

fs.writeFileSync(out, JSON.stringify(gather, null, 1));
const n = (x) => (x ? x.length : 0);
console.log(
  "wrote " + out,
  "| SHORTLIST", n(gather.SHORTLIST),
  "BENCH", n(gather.BENCH),
  "BENCH_V4", n(gather.BENCH_V4),
  "WIDE_BENCH", n(gather.WIDE_BENCH),
  "GEM_BENCH", n(gather.GEM_BENCH),
  "IMAGE_ADDS", n(gather.IMAGE_ADDS),
  "SCAN_TIER", n(gather.SCAN_TIER),
  "GROWTH", n(gather.GROWTH),
  "QUAL", n(gather.QUAL)
);