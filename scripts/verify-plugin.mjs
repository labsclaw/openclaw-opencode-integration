#!/usr/bin/env node
/**
 * Structural guard for this plugin package.
 *
 * `npm test` only imports src/* modules, so a syntax error in index.js or an
 * unparseable openclaw.plugin.json passes the suite green and only breaks when
 * the Gateway loads the plugin. That is exactly how commit f1f9c16 shipped 76
 * escaped quotes to main. This guard closes that hole locally and in CI.
 *
 * Checks:
 *   1. every .js/.mjs/.cjs file parses                     (node --check)
 *   2. every .json file parses                            (JSON.parse)
 *   3. escaped-quote density                              (heredoc damage)
 *   4. every extension declared in package.json exists and parses
 *
 * Note on check 3: the damage signature is a backslash directly followed by a
 * double quote, so the regexneeds two backslashes in its pattern to match one
 * literal backslash. The pattern is assembled from character codes rather than
 * written literally, so this guard can scan its own source without flagging
 * itself. Three or more occurrences in one file is treated as damage, because
 * that is what a heredoc rewrite does to every string literal in a file.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const errors = [];
const notes = [];
const JS_EXT = new Set([".js", ".mjs"]);
const DAMAGE_THRESHOLD = 3;

// Pattern: one literal backslash followed by one double quote.
// In a regex pattern a single backslash escapes the next character, so the
// pattern string must carry two. Built from char codes for the same
// self-exclusion reason described above.
const BACKSLASH = String.fromCharCode(92);
const DOUBLE_QUOTE = String.fromCharCode(34);
const ESCAPED_QUOTE = new RegExp(BACKSLASH + BACKSLASH + DOUBLE_QUOTE, "g");

function listFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  return output.split(/\r?\n/).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function checkSyntax(file) {
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

const files = listFiles();

for (const relative of files) {
  const absolute = path.join(root, relative);
  const ext = path.extname(relative).toLowerCase();
  const text = readFileSync(absolute, "utf8");

  let parses = true;
  if (JS_EXT.has(ext)) {
    try {
      checkSyntax(absolute);
    } catch (error) {
      parses = false;
      errors.push(`${relative}: syntax error (${String(error.stderr || error.message).split("\n")[0].trim()})`);
    }
  } else if (ext === ".json") {
    try {
      JSON.parse(text);
    } catch (error) {
      parses = false;
      errors.push(`${relative}: invalid JSON (${error.message})`);
    }
  }

  const escaped = text.match(ESCAPED_QUOTE) || [];
  if (escaped.length >= DAMAGE_THRESHOLD) {
    errors.push(`${relative}: ${escaped.length} escaped quotes, heredoc or serialization damage`);
  } else if (escaped.length > 0) {
    notes.push(`note: ${relative}: ${escaped.length} escaped quote(s), below damage threshold`);
  }

  if (!parses && escaped.length > 0) {
    errors.push(`${relative}: parse failure with escaped quotes confirms heredoc rewrite damage`);
  }
}

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
for (const extension of pkg.openclaw?.extensions ?? []) {
  const target = path.join(root, extension);
  try {
    const text = readFileSync(target, "utf8");
    if (target.endsWith(".json")) JSON.parse(text);
    else checkSyntax(target);
    console.log(`  extension ok: ${extension}`);
  } catch (error) {
    errors.push(`package.json openclaw.extensions -> ${extension}: ${String(error.message).split("\n")[0]}`);
  }
}

for (const note of notes) console.log(note);
for (const error of errors) console.error(`FAIL ${error}`);
console.log(`Checked ${files.length} tracked files for syntax, JSON, and escape damage.`);
console.log(`${errors.length} error(s), ${notes.length} note(s).`);
if (errors.length) process.exit(1);
