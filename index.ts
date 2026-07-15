/**
 * Pi Homescreen Block
 *
 * Replaces the built-in startup header with:
 *   1. QUINUS ASCII art logo (left on wide terminals, centered on narrow ones)
 *   2. Block-style extensions list (no borders, solid backgrounds)
 *   3. Block-style skills list (no borders, solid backgrounds)
 *   4. Block-style context files list (no borders, solid backgrounds)
 *
 * Also sets `quietStartup: true` in settings so Pi's default resource
 * listing doesn't clutter the chat area.
 *
 *   ┌──────────────────────────────────────────┐
 *   │                                          │
 *   │      ██████╗ ██╗   ██╗██╗███╗   ██╗    │
 *   │    ██╔═══██╗██║   ██║██║████╗  ██║    │
 *   │    ██║   ██║██║   ██║██║██╔██╗ ██║    │
 *   │    ██║▄▄ ██║██║   ██║██║██║╚██╗██║    │
 *   │    ╚██████╔╝╚██████╔╝██║██║ ╚████║    │
 *   │     ╚══▀▀═╝  ╚═════╝ ╚═╝╚═╝  ╚═══╝    │
 *   │            pi coding agent              │
 *   │                                          │
 *   │   Skills                                 │
 *   │     memory-notes                  [gl]   │
 *   │     kotlin-coroutines-flows       [gl]   │
 *   │                                          │
 *   │   Extensions                             │
 *   │     pi-homescreen-block           [gl]   │
 *   │     pi-statusbar                  [gl]   │
 *   │                                          │
 *   │   Context                                │
 *   │     AGENTS.md                     [gl]   │
 *   │     AGENTS.md                     [pr]   │
 *   │                                          │
 *   └──────────────────────────────────────────┘
 *
 * (In a color terminal the headers use the theme's selectedBg background
 * and list items use the theme's userMessageBg background.)
 *
 * When terminal is wide enough, the ASCII logo sits on the left and the
 * resource cards render in a single stacked column on the right. Context
 * stays directly below Skills.
 *
 * Commands:
 *   /logo       — Toggle the homescreen on/off
 *   /resources  — Show loaded skills, extensions & context files
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync, existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { visibleWidth } from "@earendil-works/pi-tui";

// ── MATHEMATICAL π SYMBOL (block art with baked-in shadow) ──────────────────
const LOGO: string[] = [
  "████████████████████████          ",
  "████████████████████████▒▒        ",
  "████████████████████████▒▒        ",
  "████████████████████████▒▒        ",
  "████████▒▒▒▒▒▒▒▒████████▒▒        ",
  "████████▒▒      ████████▒▒        ",
  "████████▒▒      ████████▒▒        ",
  "████████▒▒      ████████▒▒        ",
  "████████████████  ▒▒▒▒▒▒████████  ",
  "████████████████▒▒      ████████▒▒",
  "████████████████▒▒      ████████▒▒",
  "████████████████▒▒      ████████▒▒",
  "████████▒▒▒▒▒▒▒▒▒▒      ████████▒▒",
  "████████▒▒              ████████▒▒",
  "████████▒▒              ████████▒▒",
  "████████▒▒              ████████▒▒",
  "  ▒▒▒▒▒▒▒▒                ▒▒▒▒▒▒▒▒",
];

// ── DIAGONAL GRADIENT ────────────────────────────────────────────────────

const MAX_BOX_WIDTH = 72;
const MAX_ITEMS_VISIBLE = 15;

// ── SETTINGS (suppress built-in resource listing) ───────────────────────────

/**
 * Ensure `quietStartup` is enabled in Pi's global settings so the built-in
 * resource listing doesn't appear alongside our custom header.
 *
 * Only writes the file if the setting is missing or false. The change
 * takes effect on the **next** Pi start (settings are cached in memory
 * for the current session).
 */
function ensureQuietStartup(agentDir: string): void {
  const settingsPath = join(agentDir, "settings.json");
  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf-8");
      settings = JSON.parse(raw);
    }
    if (settings.quietStartup === true) return; // already set

    settings.quietStartup = true;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  } catch {
    // Best-effort — if we can't write, the extension still works.
    // The built-in resource listing just stays visible.
  }
}

// ── RESOURCE DISCOVERY ──────────────────────────────────────────────────────

type Scope = "global" | "project" | "npm" | "git";

interface ResourceInfo {
  name: string;
  path: string;
  scope: Scope;
}

function isGlobalDir(dir: string, agentDir: string, home: string): boolean {
  return dir.startsWith(agentDir) || dir.startsWith(join(home, ".agents"));
}

// ── NPM PACKAGE DISCOVERY ──────────────────────────────────────────────────

interface ParsedNpmSource {
  name: string;
  version?: string;
}

/** Parse an npm: package source like "npm:@scope/pkg@1.2.3" or "npm:pkg" */
function parseNpmSource(source: string): ParsedNpmSource | null {
  const match = source.match(/^npm:(.+)$/);
  if (!match) return null;
  const spec = match[1];
  // Split off version (last @ that isn't a scope delimiter)
  const lastAt = spec.lastIndexOf("@");
  if (lastAt > 0) {
    const name = spec.substring(0, lastAt);
    const version = spec.substring(lastAt + 1);
    return { name, version };
  }
  return { name: spec };
}

// ── GIT PACKAGE DISCOVERY ──────────────────────────────────────────────────

interface ParsedGitSource {
  host: string;
  user: string;
  repo: string;
  version?: string;
}

/** Parse a git: package source like "git:github.com/Quinus/pi-homescreen@v0.1.0" or "git:github.com/Quinus/pi-homescreen" */
function parseGitSource(source: string): ParsedGitSource | null {
  const match = source.match(/^git:([^/]+)\/([^/]+)\/([^@]+)(?:@(.+))?$/);
  if (!match) return null;
  return {
    host: match[1],
    user: match[2],
    repo: match[3],
    version: match[4],
  };
}

/**
 * Find where a git package is installed.
 * Git packages are stored in: ~/.pi/agent/git/<host>/<user>/<repo>
 */
function findGitPackagePath(
  host: string,
  user: string,
  repo: string,
  agentDir: string,
): string | undefined {
  const gitDir = join(agentDir, "git", host, user, repo);
  if (existsSync(join(gitDir, "package.json"))) return gitDir;
  return undefined;
}

/**
 * Discover pi extensions installed via git packages (from settings.json "packages").
 */
function discoverGitExtensions(agentDir: string): ResourceInfo[] {
  const items: ResourceInfo[] = [];
  const seen = new Set<string>();

  // Read global settings
  const globalSettings = readSettings(agentDir);

  const sources = getPackageSources(globalSettings);

  for (const source of sources) {
    const parsed = parseGitSource(source);
    if (!parsed) continue; // skip non-git sources

    const normalizedRepo = parsed.repo;
    if (seen.has(normalizedRepo)) continue;
    seen.add(normalizedRepo);

    const pkgDir = findGitPackagePath(parsed.host, parsed.user, parsed.repo, agentDir);
    if (!pkgDir) continue;

    // Check if this package has extensions
    const extNames = getPiExtensionsFromPackage(pkgDir);
    if (extNames.length === 0) continue;

    // Use the repo name as the extension display name
    items.push({ name: normalizedRepo, path: pkgDir, scope: "git" });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** Get the global npm root directory (e.g. /opt/homebrew/lib/node_modules) */
let cachedNpmRoot: string | undefined;
function getGlobalNpmRoot(): string {
  if (cachedNpmRoot) return cachedNpmRoot;
  try {
    cachedNpmRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
  } catch {
    cachedNpmRoot = "";
  }
  return cachedNpmRoot;
}

/** Read settings.json from a directory, returning parsed JSON or empty object */
function readSettings(dir: string): Record<string, unknown> {
  const p = join(dir, "settings.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

/** Extract package source strings from settings (supports string and object forms) */
function getPackageSources(settings: Record<string, unknown>): string[] {
  const packages = settings.packages;
  if (!Array.isArray(packages)) return [];
  return packages
    .map((p: unknown) => {
      if (typeof p === "string") return p;
      if (typeof p === "object" && p !== null && "source" in p) {
        return (p as { source: string }).source;
      }
      return null;
    })
    .filter((s): s is string => s !== null);
}

/**
 * Find where an npm package is installed.
 * Checks pi-managed paths first, then legacy global npm install.
 */
function findNpmPackagePath(pkgName: string, agentDir: string, cwd: string): string | undefined {
  // 1. Pi-managed global: ~/.pi/agent/npm/node_modules/<name>
  const managedGlobal = join(agentDir, "npm", "node_modules", pkgName);
  if (existsSync(join(managedGlobal, "package.json"))) return managedGlobal;

  // 2. Pi-managed project: <cwd>/.pi/npm/node_modules/<name>
  const managedProject = join(cwd, ".pi", "npm", "node_modules", pkgName);
  if (existsSync(join(managedProject, "package.json"))) return managedProject;

  // 3. Legacy global npm: <npm root -g>/<name>
  const globalRoot = getGlobalNpmRoot();
  if (globalRoot) {
    const legacyGlobal = join(globalRoot, pkgName);
    if (existsSync(join(legacyGlobal, "package.json"))) return legacyGlobal;

    // Scoped packages: <npm root -g>/@scope/<name>
    // Already handled above, but handle scoped name like @scope/pkg
  }

  return undefined;
}

/**
 * Read the pi manifest from a package.json to discover declared extensions.
 * Returns list of extension names found.
 */
function getPiExtensionsFromPackage(pkgDir: string): string[] {
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return [];

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return [];
  }

  const names: string[] = [];

  // Check pi.extensions manifest
  const pi = pkg.pi as Record<string, unknown> | undefined;
  if (pi && Array.isArray(pi.extensions)) {
    for (const entry of pi.extensions) {
      if (typeof entry !== "string") continue;
      // Resolve the path relative to the package root
      const resolved = join(pkgDir, entry);
      const dir = statSync(resolved, { throwIfNoEntry: false });
      if (!dir) continue;
      if (dir.isFile() && (entry.endsWith(".ts") || entry.endsWith(".js"))) {
        const name =
          entry
            .split("/")
            .pop()
            ?.replace(/\.(ts|js)$/, "") ?? entry;
        names.push(name);
      } else if (dir.isDirectory()) {
        // Directory with index.ts/js
        const indexTs = join(resolved, "index.ts");
        const indexJs = join(resolved, "index.js");
        if (existsSync(indexTs) || existsSync(indexJs)) {
          names.push(entry.split("/").filter(Boolean).pop() ?? entry);
        }
      }
    }
  } else {
    // Fallback: convention directory "extensions/"
    const extDir = join(pkgDir, "extensions");
    if (existsSync(extDir)) {
      try {
        for (const entry of readdirSync(extDir)) {
          const fullPath = join(extDir, entry);
          const s = statSync(fullPath, { throwIfNoEntry: false });
          if (!s) continue;
          if (s.isFile() && (entry.endsWith(".ts") || entry.endsWith(".js"))) {
            names.push(entry.replace(/\.(ts|js)$/, ""));
          } else if (
            s.isDirectory() &&
            (existsSync(join(fullPath, "index.ts")) || existsSync(join(fullPath, "index.js")))
          ) {
            names.push(entry);
          }
        }
      } catch {
        // skip
      }
    }
  }

  return names;
}

/**
 * Discover pi extensions installed via npm packages (from settings.json "packages").
 */
function discoverNpmExtensions(cwd: string, agentDir: string): ResourceInfo[] {
  const items: ResourceInfo[] = [];
  const seen = new Set<string>();

  // Read both global and project settings
  const globalSettings = readSettings(agentDir);
  const projectSettingsDir = join(cwd, ".pi");
  const projectSettings = existsSync(projectSettingsDir) ? readSettings(projectSettingsDir) : {};

  const sources = [...getPackageSources(globalSettings), ...getPackageSources(projectSettings)];

  // Deduplicate by package name
  const seenPackages = new Set<string>();

  for (const source of sources) {
    const parsed = parseNpmSource(source);
    if (!parsed) continue; // skip non-npm sources (git, local paths)

    const normalizedName = parsed.name;
    if (seenPackages.has(normalizedName)) continue;
    seenPackages.add(normalizedName);

    const pkgDir = findNpmPackagePath(normalizedName, agentDir, cwd);
    if (!pkgDir) continue;

    // Use the npm package name as the extension display name.
    // Individual extension files within the package are implementation details;
    // the package itself is the installable extension unit.
    const extNames = getPiExtensionsFromPackage(pkgDir);
    if (extNames.length === 0) continue;

    // Use the normalized package name (e.g. "pi-mcp-adapter" instead of "index")
    const displayName = normalizedName;
    if (!seen.has(displayName)) {
      seen.add(displayName);
      items.push({ name: displayName, path: pkgDir, scope: "npm" });
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

// ── LOCAL EXTENSION DISCOVERY ──────────────────────────────────────────────

function discoverExtensions(cwd: string, agentDir: string): ResourceInfo[] {
  const items: ResourceInfo[] = [];
  const seen = new Set<string>();
  const dirs: [string, Scope][] = [
    [join(agentDir, "extensions"), "global"],
    [join(cwd, ".pi", "extensions"), "project"],
  ];

  for (const [dir, scope] of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        let name: string | null = null;
        try {
          const s = statSync(fullPath);
          if (s.isFile() && entry.endsWith(".ts")) {
            name = entry.replace(/\.ts$/, "");
          } else if (s.isDirectory() && existsSync(join(fullPath, "index.ts"))) {
            name = entry;
          }
        } catch {
          continue;
        }
        if (name && !seen.has(name)) {
          seen.add(name);
          items.push({ name, path: fullPath, scope });
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  // Merge npm extensions
  const npmExts = discoverNpmExtensions(cwd, agentDir);
  for (const ext of npmExts) {
    if (!seen.has(ext.name)) {
      seen.add(ext.name);
      items.push(ext);
    }
  }

  // Merge git extensions
  const gitExts = discoverGitExtensions(agentDir);
  for (const ext of gitExts) {
    if (!seen.has(ext.name)) {
      seen.add(ext.name);
      items.push(ext);
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

function scanSkillDirs(dir: string, scope: Scope): ResourceInfo[] {
  const items: ResourceInfo[] = [];
  if (!existsSync(dir)) return items;
  try {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      try {
        const s = statSync(fullPath);
        if (s.isDirectory()) {
          if (existsSync(join(fullPath, "SKILL.md"))) {
            items.push({ name: entry, path: fullPath, scope });
          }
        } else if (s.isFile() && entry.endsWith(".md")) {
          const name = entry.replace(/\.md$/, "");
          items.push({ name, path: fullPath, scope });
        }
      } catch {
        continue;
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return items;
}

function discoverSkills(cwd: string, agentDir: string, home: string): ResourceInfo[] {
  const items: ResourceInfo[] = [];
  const seen = new Set<string>();

  const dirs: [string, Scope][] = [
    [join(agentDir, "skills"), "global"],
    [join(home, ".agents", "skills"), "global"],
    [join(cwd, ".agents", "skills"), "project"],
    [join(cwd, ".pi", "skills"), "project"],
  ];

  for (const [dir, scope] of dirs) {
    const scanned = scanSkillDirs(dir, scope);
    for (const skill of scanned) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        items.push(skill);
      }
    }
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

// ── CONTEXT FILE DISCOVERY ───────────────────────────────────────────────────

/** Context file names to look for */
const CONTEXT_FILE_NAMES = ["AGENTS.md", "CLAUDE.md"];
const SYSTEM_FILE_NAMES = ["SYSTEM.md", "APPEND_SYSTEM.md"];

function discoverContextFiles(cwd: string, agentDir: string): ResourceInfo[] {
  const items: ResourceInfo[] = [];
  const seen = new Set<string>();

  function addFile(filePath: string, scope: Scope) {
    if (!existsSync(filePath)) return;
    const name = filePath.split("/").pop() ?? filePath;
    const key = `${name}:${scope}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name, path: filePath, scope });
  }

  // Global context files
  for (const name of CONTEXT_FILE_NAMES) {
    addFile(join(agentDir, name), "global");
  }

  // Global system prompt files
  for (const name of SYSTEM_FILE_NAMES) {
    addFile(join(agentDir, name), "global");
  }

  // Walk up from cwd looking for context files
  let dir = cwd;
  const home = homedir();
  while (dir && dir !== home && dir !== "/") {
    for (const name of CONTEXT_FILE_NAMES) {
      addFile(join(dir, name), "project");
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // Current directory
  for (const name of CONTEXT_FILE_NAMES) {
    addFile(join(cwd, name), "project");
  }

  // Project .pi directory system files
  const piDir = join(cwd, ".pi");
  for (const name of SYSTEM_FILE_NAMES) {
    addFile(join(piDir, name), "project");
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

// ── ANSI HELPERS ───────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function hexToRgb(hex: string): [number, number, number] {
  const num = parseInt(hex.replace("#", ""), 16);
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

function rgbBg(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

function gradientFg(startHex: string, endHex: string, t: number): string {
  const [startR, startG, startB] = hexToRgb(startHex);
  const [endR, endG, endB] = hexToRgb(endHex);
  const r = Math.round(startR + t * (endR - startR));
  const g = Math.round(startG + t * (endG - startG));
  const b = Math.round(startB + t * (endB - startB));
  return `\x1b[38;2;${r};${g};${b}m`;
}

/** Extract the resolved hex color from an ANSI fg escape sequence. */
function ansiToHex(ansi: string): string {
  const m = ansi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  if (m) {
    return `#${[m[1], m[2], m[3]].map((c) => parseInt(c).toString(16).padStart(2, "0")).join("")}`;
  }
  return "";
}

/** Get the resolved hex for a theme fg color token. */
function resolveFg(theme: ThemeColors, color: string): string {
  return ansiToHex(theme.getFgAnsi(color));
}

/** Get the resolved hex for a theme bg color token. */
function resolveBg(theme: ThemeColors, color: string): string {
  return ansiToHex(theme.getBgAnsi(color));
}

// ── BLOCK-STYLE LIST RENDERING ──────────────────────────────────────────────

interface ThemeColors {
  fg: (color: string, text: string) => string;
  bg: (color: string, text: string) => string;
  bold: (text: string) => string;
  getFgAnsi: (color: string) => string;
  getBgAnsi: (color: string) => string;
}

/**
 * Render a block-style list with no borders, inspired by tmux/lualine segments:
 *
 *   [surface]  Title                    [reset]
 *   [base]       item 1           [gl]   [reset]
 *   [base]       item 2           [pr]   [reset]
 */
function renderBlockList(theme: ThemeColors, title: string, items: ResourceInfo[], blockWidth: number): string[] {
  if (items.length === 0) return [];

  const headerBg = rgbBg(resolveBg(theme, "selectedBg"));
  const headerFg = theme.getFgAnsi("text") + BOLD;
  const itemBg = rgbBg(resolveBg(theme, "userMessageBg"));
  const itemFg = theme.getFgAnsi("text");
  const dimBadgeFg = theme.getFgAnsi("muted");
  const accentBadgeFg = theme.getFgAnsi("accent");

  const lines: string[] = [];

  // Header block: solid surface background, bold base-colored text.
  const titleVisible = ` ${title}`;
  const titlePad = Math.max(0, blockWidth - titleVisible.length);
  lines.push(headerBg + headerFg + titleVisible + " ".repeat(titlePad) + RESET);

  // Item blocks: dim background, light text.
  for (const item of items) {
    const row = `  ${item.name}`;
    const rowWidth = visibleWidth(row);

    let badge: string;
    if (item.scope === "npm") {
      badge = "[npm]";
    } else if (item.scope === "git") {
      badge = "[git]";
    } else if (item.scope === "project") {
      badge = "[pr]";
    } else {
      badge = "[gl]";
    }
    const badgeWidth = visibleWidth(badge);
    const padding = Math.max(1, blockWidth - rowWidth - badgeWidth - 1);

    const badgeStyled = item.scope === "global" ? dimBadgeFg + badge : accentBadgeFg + badge;

    lines.push(itemBg + itemFg + row + " ".repeat(padding) + badgeStyled + " " + RESET);
  }

  return lines;
}

// ── HEADER CONSTRUCTION ─────────────────────────────────────────────────────

/** Gap between side-by-side boxes */
const BOX_GAP = 4;
/** Minimum terminal width to render side-by-side (2 boxes + gap + outer padding) */
const SIDE_BY_SIDE_THRESHOLD = MAX_BOX_WIDTH * 2 + BOX_GAP + 4;
const MIN_SIDE_BY_SIDE_BOX_WIDTH = 36;

/** Render the PI logo, optionally centered or left-aligned inside a column. */
function renderLogoLines(theme: ThemeColors, width: number, align: "center" | "left"): string[] {
  const maxLogoWidth = Math.max(...LOGO.map((line) => line.length));
  const padding = align === "center" ? Math.max(0, Math.floor((width - maxLogoWidth) / 2)) : 0;
  const leftPad = " ".repeat(padding);
  const chunkSize = 4;
  const accentHex = resolveFg(theme, "accent");
  const borderAccentHex = resolveFg(theme, "borderAccent");

  return LOGO.map((line, i) => {
    const renderedLine = line
      .split("")
      .map((char, j) => {
        if (char === " ") return char;
        if (char === "▒") return theme.fg("dim", char);
        // Determine chunk position
        const chunkRow = Math.floor(i / chunkSize);
        const chunkCol = Math.floor(j / chunkSize);
        // Each chunk gets a unique phase offset based on position
        const phase = ((chunkRow * 7919 + chunkCol * 104729) & 0x7fffffff) / 100000;
        // Smooth gradient based on position only (no animation)
        const t = (Math.sin(phase) + 1) / 2;
        // Interpolate between accent and borderAccent from the theme.
        return gradientFg(accentHex, borderAccentHex, t) + char + "\x1b[39m";
      })
      .join("");
    return leftPad + renderedLine;
  });
}

/** Render extensions, skills and context as a single resource column. */
function buildResourceLines(
  theme: ThemeColors,
  width: number,
  skills: ResourceInfo[],
  extensions: ResourceInfo[],
  contextFiles: ResourceInfo[],
): string[] {
  const lines: string[] = [];
  const boxWidth = Math.max(4, Math.min(Math.max(1, width) - 2, MAX_BOX_WIDTH));

  const extLines = extensions.length > 0 ? renderBlockList(theme, "Extensions", extensions, boxWidth) : [];
  const skillLines = skills.length > 0 ? renderBlockList(theme, "Skills", skills, boxWidth) : [];
  const ctxLines =
    contextFiles.length > 0 ? renderBlockList(theme, "Context", contextFiles, boxWidth) : [];

  const sections = [extLines, skillLines, ctxLines].filter((section) => section.length > 0);
  sections.forEach((section, index) => {
    if (index > 0) lines.push("");
    lines.push(...section);
  });

  return lines;
}

/** Pad box lines to equal height and interleave them side-by-side */
function sideBySide(
  leftLines: string[],
  rightLines: string[],
  leftWidth: number,
  rightWidth: number,
  gap: string,
): string[] {
  const maxLen = Math.max(leftLines.length, rightLines.length);
  const result: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const left = leftLines[i] ?? " ".repeat(leftWidth);
    const right = rightLines[i] ?? " ".repeat(rightWidth);
    // Pad each side to its box width so columns align
    const leftPadRight = Math.max(0, leftWidth - visibleWidth(left));
    const rightPadRight = Math.max(0, rightWidth - visibleWidth(right));
    result.push(left + " ".repeat(leftPadRight) + gap + right + " ".repeat(rightPadRight));
  }
  return result;
}

function buildHeaderLines(
  theme: ThemeColors,
  width: number,
  skills: ResourceInfo[],
  extensions: ResourceInfo[],
  contextFiles: ResourceInfo[],
  cwd: string,
  model?: string,
): string[] {
  const result: string[] = [];
  const logoWidth = Math.max(...LOGO.map((line) => line.length));
  const hasResources = skills.length > 0 || extensions.length > 0 || contextFiles.length > 0;

  // ── Current folder and model ──
  const folderName = cwd.split("/").filter(Boolean).pop() || "~";
  const modelInfo = model ? `using ${model}` : "";
  const subtitle =
    theme.bold(theme.fg("borderAccent", folderName)) +
    (modelInfo ? "  " + theme.fg("text", modelInfo) : "");
  const subWidth = visibleWidth(subtitle);
  const leftPanelWidth = Math.max(logoWidth, subWidth);
  const resourceWidth = Math.max(1, Math.min(width - leftPanelWidth - BOX_GAP - 4, MAX_BOX_WIDTH));
  const useWideLayout = width >= 100 && hasResources && resourceWidth >= MIN_SIDE_BY_SIDE_BOX_WIDTH;

  if (useWideLayout) {
    const logoBlockLines = [
      ...renderLogoLines(theme, leftPanelWidth, "center"),
      "",
      " ".repeat(Math.max(0, Math.floor((leftPanelWidth - subWidth) / 2))) + subtitle,
    ];
    const resourceLines = buildResourceLines(
      theme,
      resourceWidth,
      skills,
      extensions,
      contextFiles,
    );

    // Vertically center both blocks relative to each other
    const heightDiff = Math.abs(resourceLines.length - logoBlockLines.length);
    const topPad = Math.floor(heightDiff / 2);
    const bottomPad = heightDiff - topPad;

    const leftLines =
      resourceLines.length >= logoBlockLines.length
        ? [
            ...Array(topPad).fill(" ".repeat(leftPanelWidth)),
            ...logoBlockLines,
            ...Array(bottomPad).fill(" ".repeat(leftPanelWidth)),
          ]
        : [...logoBlockLines];

    const rightLines =
      logoBlockLines.length > resourceLines.length
        ? [
            ...Array(topPad).fill(" ".repeat(resourceWidth)),
            ...resourceLines,
            ...Array(bottomPad).fill(" ".repeat(resourceWidth)),
          ]
        : [...resourceLines];

    const combinedWidth = leftPanelWidth + BOX_GAP + resourceWidth;
    const leftPad = Math.max(0, Math.floor((width - combinedWidth) / 2));

    result.push("");
    const combined = sideBySide(
      leftLines,
      rightLines,
      leftPanelWidth,
      resourceWidth,
      " ".repeat(BOX_GAP),
    );
    for (const line of combined) {
      result.push(" ".repeat(leftPad) + line);
    }
    result.push("");
    result.push(theme.fg("border", "─".repeat(Math.max(1, width))));
    return result;
  }

  // Decide layout: side-by-side when wide enough, stacked otherwise
  const useSideBySide =
    width >= SIDE_BY_SIDE_THRESHOLD && skills.length > 0 && extensions.length > 0;
  const boxWidth = useSideBySide
    ? Math.min(Math.floor((width - BOX_GAP - 4) / 2), MAX_BOX_WIDTH)
    : Math.min(width - 4, MAX_BOX_WIDTH);
  const totalBoxesWidth = useSideBySide ? boxWidth * 2 + BOX_GAP : boxWidth;
  const pad = Math.max(0, Math.floor((width - totalBoxesWidth) / 2));
  const leftPad = " ".repeat(pad);

  // ── Top spacing ──
  result.push("");

  // ── PI ASCII logo (centered) with interpolated color per square chunk ──
  const maxLogoWidth = Math.max(...LOGO.map((l) => l.length));
  const chunkSize = 4;
  const logoAccentHex = resolveFg(theme, "accent");
  const logoBorderAccentHex = resolveFg(theme, "borderAccent");
  for (let i = 0; i < LOGO.length; i++) {
    const line = LOGO[i];
    const padding = Math.max(0, Math.floor((width - maxLogoWidth) / 2));
    const renderedLine = line
      .split("")
      .map((char, j) => {
        if (char === " ") return char;
        if (char === "▒") return theme.fg("dim", char);
        // Determine chunk position
        const chunkRow = Math.floor(i / chunkSize);
        const chunkCol = Math.floor(j / chunkSize);
        // Each chunk gets a unique phase offset based on position
        const phase = ((chunkRow * 7919 + chunkCol * 104729) & 0x7fffffff) / 100000;
        // Smooth gradient based on position only (no animation)
        const t = (Math.sin(phase) + 1) / 2;
        // Interpolate between accent and borderAccent from the theme.
        return gradientFg(logoAccentHex, logoBorderAccentHex, t) + char + "\x1b[39m";
      })
      .join("");
    result.push(" ".repeat(padding) + renderedLine);
  }

  result.push(""); // extra spacing after logo

  // ── Current folder and model ──
  const subPad = Math.max(0, Math.floor((width - subWidth) / 2));
  result.push(" ".repeat(subPad) + subtitle);

  result.push(""); // spacer

  const skillLines = skills.length > 0 ? renderBlockList(theme, "Skills", skills, boxWidth) : [];
  const extLines = extensions.length > 0 ? renderBlockList(theme, "Extensions", extensions, boxWidth) : [];
  const ctxLines =
    contextFiles.length > 0 ? renderBlockList(theme, "Context", contextFiles, boxWidth) : [];

  if (useSideBySide) {
    // ── Side-by-side layout ──
    // Stack Skills + Context on left, Extensions on right
    // This fills the vertical gap when Skills is shorter than Extensions
    const leftLines = [...skillLines, ...ctxLines];
    const rightLines = extLines;
    const gap = " ".repeat(BOX_GAP);
    const combined = sideBySide(leftLines, rightLines, boxWidth, boxWidth, gap);
    for (const line of combined) {
      result.push(leftPad + line);
    }
    result.push("");
  } else {
    // ── Stacked layout ──
    for (const line of skillLines) {
      result.push(leftPad + line);
    }
    if (skillLines.length > 0) result.push("");
    for (const line of extLines) {
      result.push(leftPad + line);
    }
    if (extLines.length > 0) result.push("");
    // ── Context files (stacked below in narrow mode) ──
    for (const line of ctxLines) {
      result.push(leftPad + line);
    }
    if (ctxLines.length > 0) result.push("");
  }

  // ── Full-width separator ──
  result.push(theme.fg("border", "─".repeat(Math.max(1, width))));

  return result;
}

// ── EXTENSION ENTRY POINT ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let headerActive = false;
  let cachedSkills: ResourceInfo[] = [];
  let cachedExtensions: ResourceInfo[] = [];
  let cachedContextFiles: ResourceInfo[] = [];

  // On first load, make sure quietStartup is enabled so Pi's built-in
  // resource listing doesn't appear alongside our custom header.
  const agentDir = join(homedir(), ".pi", "agent");
  ensureQuietStartup(agentDir);

  function refreshResources(cwd: string) {
    cachedSkills = discoverSkills(cwd, agentDir, homedir());
    // Clear npm root cache so we re-detect on /reload
    cachedNpmRoot = undefined;
    cachedExtensions = discoverExtensions(cwd, agentDir);
    cachedContextFiles = discoverContextFiles(cwd, agentDir);
  }

  function showHeader(ctx: {
    hasUI: boolean;
    cwd: string;
    model?: any;
    ui: { setHeader: (f: any) => void };
  }) {
    if (!ctx.hasUI) return;
    headerActive = true;
    refreshResources(ctx.cwd);

    const currentCwd = ctx.cwd;
    let modelStr: string | undefined;
    if (ctx.model) {
      if (typeof ctx.model === "string") {
        modelStr = ctx.model;
      } else if (ctx.model.name) {
        modelStr = ctx.model.name;
      } else if (ctx.model.id) {
        modelStr = ctx.model.id;
      }
    }

    ctx.ui.setHeader((tui: { requestRender: () => void }, theme: ThemeColors) => {
      return {
        render(width: number): string[] {
          return buildHeaderLines(
            theme,
            width,
            cachedSkills,
            cachedExtensions,
            cachedContextFiles,
            currentCwd,
            modelStr,
          );
        },
        invalidate() {},
        dispose() {},
      };
    });
  }

  function hideHeader(ctx: { ui: { setHeader: (f: undefined) => void } }) {
    if (!headerActive) return;
    ctx.ui.setHeader(undefined);
    headerActive = false;
  }

  // ── Show on session start ──
  pi.on("session_start", async (_event, ctx) => {
    showHeader(ctx);
  });

  // ── Hide on first user message ──
  pi.on("before_agent_start", async (_event, ctx) => {
    hideHeader(ctx);
  });

  // ── /logo: toggle the homescreen ──
  pi.registerCommand("logo", {
    description: "Toggle the QUINUS homescreen with skills, extensions & context files",
    handler: async (_args, ctx) => {
      if (headerActive) {
        hideHeader(ctx);
        ctx.ui.notify("Homescreen hidden. Use /logo to show it again.", "info");
      } else {
        showHeader(ctx);
        ctx.ui.notify("Homescreen shown. Send a message to hide it.", "info");
      }
    },
  });

  // ── /resources: list loaded resources ──
  pi.registerCommand("resources", {
    description: "Show loaded extensions, skills & context files in a notification",
    handler: async (_args, ctx) => {
      refreshResources(ctx.cwd);

      const parts: string[] = [];
      if (cachedExtensions.length > 0) {
        parts.push(
          `Extensions (${cachedExtensions.length}): ${cachedExtensions.map((e) => e.name).join(", ")}`,
        );
      } else {
        parts.push("Extensions: none");
      }
      if (cachedSkills.length > 0) {
        parts.push(
          `Skills (${cachedSkills.length}): ${cachedSkills.map((s) => s.name).join(", ")}`,
        );
      } else {
        parts.push("Skills: none");
      }
      if (cachedContextFiles.length > 0) {
        parts.push(
          `Context (${cachedContextFiles.length}): ${cachedContextFiles.map((c) => c.name).join(", ")}`,
        );
      } else {
        parts.push("Context: none");
      }

      ctx.ui.notify(parts.join("  ·  "), "info");
    },
  });

  // ── Re-discover on /reload ──
  pi.on("resources_discover", async (_event, ctx) => {
    refreshResources(ctx.cwd);
    if (headerActive) {
      showHeader(ctx);
    }
  });
}
