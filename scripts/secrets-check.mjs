#!/usr/bin/env node
// Secrets-Pruefung vor dem Commit und von Hand.
//
//   node scripts/secrets-check.mjs --staged   nur die gestagten Aenderungen (pre-commit-Hook)
//   node scripts/secrets-check.mjs            der ganze Arbeitsbaum (pnpm secrets)
//
// Ist gitleaks installiert, prueft gitleaks mit derselben Konfiguration wie die
// CI (gitleaks-action nutzt die eingebaute Standard-Konfiguration bzw. eine
// .gitleaks.toml im Repo-Wurzelverzeichnis, falls es sie gibt). Ohne gitleaks
// laeuft eine kleine eingebaute Notpruefung auf die offensichtlichsten Muster.
// Dieses Script installiert oder laedt nie etwas herunter und gibt gefundene
// Werte nie aus, nur Datei, Zeile und Regel.
//
// Exit-Codes: 0 sauber, 1 Fund, 2 Fehler der Pruefung selbst.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STAGED = process.argv.includes("--staged");
const INSTALL_HINT = [
  "Install gitleaks for the full check (same rules as CI):",
  "  macOS:  brew install gitleaks",
  "  other:  https://github.com/gitleaks/gitleaks#installing",
];

// Dateien unter dieser Groesse werden in der Notpruefung gelesen; groessere
// sind fast immer Build-Artefakte oder Binaerdaten.
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Notpruefung: Inhaltsmuster. Bewusst eng gehalten, damit sie nicht staendig
// Fehlalarm gibt; die volle Pruefung macht gitleaks.
const CONTENT_RULES = [
  { id: "private-key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-pat", re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { id: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { id: "aws-access-key-id", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { id: "slack-token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { id: "slack-webhook", re: /hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/ },
  { id: "anthropic-api-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "openai-api-key", re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/ },
  { id: "stripe-live-key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "npm-token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "pypi-token", re: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/ },
];

// Notpruefung: Dateipfade, die nie ins Repo gehoeren.
const PATH_RULES = [
  {
    id: "env-file",
    test: (p) => {
      const base = path.posix.basename(p);
      return /^\.env(?:\..+)?$/.test(base) && base !== ".env.example";
    },
  },
  { id: "local-agent-credentials", test: (p) => p.startsWith("infra/lokal/.agents/") },
  {
    id: "private-key-file",
    test: (p) => /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$|\.(?:pem|key|p12|pfx)$/.test(p),
  },
];

function git(args, opts = {}) {
  const res = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: opts.encoding ?? "utf8",
    maxBuffer: 256 * 1024 * 1024,
    cwd: opts.cwd,
  });
  if (res.error || res.status !== 0) {
    const msg = res.error ? res.error.message : String(res.stderr).trim();
    throw new Error(`git ${args.join(" ")} failed: ${msg}`);
  }
  return res.stdout;
}

function findGitleaks() {
  const res = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (res.error || res.status !== 0) return null;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(res.stdout);
  // Unbekanntes Versionsformat (z.B. Eigenbau): neue Syntax annehmen.
  if (!m) return { version: res.stdout.trim(), modern: true };
  const [major, minor] = [Number(m[1]), Number(m[2])];
  // Ab 8.19.0 gibt es `gitleaks git` und `gitleaks dir`; `protect`/`detect`
  // sind seitdem veraltet.
  return { version: m[0], modern: major > 8 || (major === 8 && minor >= 19) };
}

function configArgs(root) {
  const cfg = path.join(root, ".gitleaks.toml");
  return fs.existsSync(cfg) ? ["--config", cfg] : [];
}

function runGitleaks(gl, root) {
  const common = ["--redact", "--no-banner", "--verbose", ...configArgs(root)];
  let args;
  let cwd = root;
  let tmp = null;

  if (STAGED) {
    args = gl.modern
      ? ["git", "--pre-commit", "--staged", ...common, root]
      : ["protect", "--staged", "--source", root, ...common];
  } else {
    // Nur Dateien pruefen, die git sieht (versioniert oder neu und nicht
    // ignoriert). Ein direkter `gitleaks dir` auf das Repo wuerde node_modules
    // und lokale, absichtlich ignorierte .env-Dateien mitlesen.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openapps-secrets-"));
    for (const rel of listWorktreeFiles(root)) {
      const src = path.join(root, rel);
      let st;
      try {
        st = fs.lstatSync(src);
      } catch {
        continue; // geloescht, aber noch im Index
      }
      if (!st.isFile()) continue;
      const dst = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    cwd = tmp;
    args = gl.modern
      ? ["dir", ".", ...common]
      : ["detect", "--no-git", "--source", ".", ...common];
  }

  console.error(`secrets: gitleaks ${gl.version} (${STAGED ? "staged changes" : "working tree"})`);
  try {
    const res = spawnSync("gitleaks", args, { cwd, stdio: "inherit" });
    if (res.error) {
      console.error(`secrets: could not run gitleaks: ${res.error.message}`);
      return 2;
    }
    return res.status === 0 ? 0 : 1;
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function listWorktreeFiles(root) {
  return git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
    .split("\0")
    .filter(Boolean);
}

function scanLine(file, lineNo, text, findings) {
  // Gleiche Ausnahme-Markierung wie gitleaks.
  if (text.includes("gitleaks:allow")) return;
  for (const rule of CONTENT_RULES) {
    if (rule.re.test(text)) findings.push({ file, line: lineNo, rule: rule.id });
  }
}

function scanPaths(files, findings) {
  for (const file of files) {
    for (const rule of PATH_RULES) {
      if (rule.test(file)) findings.push({ file, line: null, rule: rule.id });
    }
  }
}

// Notpruefung der gestagten Aenderungen: nur hinzugefuegte Zeilen.
function fallbackStaged(root) {
  const findings = [];
  const names = git(
    ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--no-renames"],
    { cwd: root },
  )
    .split("\0")
    .filter(Boolean);
  scanPaths(names, findings);

  const diff = git(
    [
      "diff",
      "--cached",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--unified=0",
      "--diff-filter=ACMR",
      "--src-prefix=a/",
      "--dst-prefix=b/",
    ],
    { cwd: root },
  );

  let file = null;
  let lineNo = 0;
  let inHeader = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHeader = true;
      file = null;
      continue;
    }
    if (inHeader) {
      if (raw.startsWith("+++ ")) {
        const target = raw.slice(4);
        file = target === "/dev/null" ? null : target.replace(/^b\//, "");
      } else if (raw.startsWith("@@")) {
        inHeader = false;
      } else {
        continue;
      }
    }
    if (raw.startsWith("@@")) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      lineNo = m ? Number(m[1]) : 0;
      continue;
    }
    if (raw.startsWith("+") && file) {
      scanLine(file, lineNo, raw.slice(1), findings);
      lineNo += 1;
    }
    // Entfernte Zeilen ("-") und "\ No newline" zaehlen nicht fuer die neue Datei.
  }
  return findings;
}

// Notpruefung des Arbeitsbaums: alle Dateien, die git sieht.
function fallbackWorktree(root) {
  const findings = [];
  const files = listWorktreeFiles(root);
  scanPaths(files, findings);
  for (const rel of files) {
    const abs = path.join(root, rel);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
    const buf = fs.readFileSync(abs);
    // Binaerdateien ueberspringen (gleiche Heuristik wie git: NUL-Byte vorne).
    if (buf.subarray(0, 8000).includes(0)) continue;
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) scanLine(rel, i + 1, lines[i], findings);
  }
  return findings;
}

function main() {
  let root;
  try {
    root = git(["rev-parse", "--show-toplevel"]).trim();
  } catch (err) {
    console.error(`secrets: not inside a git repository (${err.message})`);
    return 2;
  }

  const gl = findGitleaks();
  if (gl) {
    const code = runGitleaks(gl, root);
    if (code === 1) {
      console.error("\nsecrets: gitleaks found possible secrets. Commit blocked.");
      console.error("Remove the secret (and rotate it if it was real). For a verified false");
      console.error("positive, add `gitleaks:allow` as a comment on that line.");
    }
    return code;
  }

  console.error("secrets: gitleaks is not installed. Running the built-in minimal check only.");
  let findings;
  try {
    findings = STAGED ? fallbackStaged(root) : fallbackWorktree(root);
  } catch (err) {
    console.error(`secrets: check failed: ${err.message}`);
    return 2;
  }

  if (findings.length > 0) {
    console.error(`\nsecrets: ${findings.length} possible secret(s) found:`);
    for (const f of findings) {
      console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  [${f.rule}]`);
    }
    console.error("\nRemove the secret (and rotate it if it was real), or unstage the file.");
    console.error("For a verified false positive, add `gitleaks:allow` as a comment on that line.");
    console.error("");
    for (const l of INSTALL_HINT) console.error(l);
    return 1;
  }

  console.error("secrets: no obvious secrets found (minimal check).");
  for (const l of INSTALL_HINT) console.error(l);
  return 0;
}

process.exit(main());
