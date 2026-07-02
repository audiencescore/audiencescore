#!/usr/bin/env node
'use strict';

// Markdown link checker. Fails CI on two classes of broken link:
//
//   1. Dead relative links — a link target that does not exist in the repo.
//   2. Pages-escaping links — a relative link inside docs/ whose target
//      lives outside docs/. GitHub Pages only publishes the docs/ folder,
//      so such links 404 on the live site even though the file exists in
//      the repo. Link to a github.com/blob URL instead.
//
// External (http/https/mailto) links and pure #anchors are not checked.

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const docsDir = path.join(repoRoot, 'docs');
const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Recursively collect every .md file in the repo. */
function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...markdownFiles(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** Strip fenced code blocks so diagrams/examples don't yield false links. */
function stripCodeFences(text) {
  return text.replace(/```[\s\S]*?```/g, '');
}

const LINK_RE = /\]\(([^)]+)\)/g;

const problems = [];

for (const file of markdownFiles(repoRoot)) {
  const rel = path.relative(repoRoot, file);
  const body = stripCodeFences(fs.readFileSync(file, 'utf8'));
  const fileDir = path.dirname(file);
  const insideDocs = file === docsDir || file.startsWith(docsDir + path.sep);

  let m;
  while ((m = LINK_RE.exec(body)) !== null) {
    const raw = m[1].trim();
    if (/^(https?:|mailto:|tel:|#)/i.test(raw) || raw === '') continue;

    const targetPath = raw.split('#')[0];
    if (targetPath === '') continue; // pure anchor

    const resolved = path.resolve(fileDir, targetPath);

    if (!fs.existsSync(resolved)) {
      problems.push(`${rel}: dead link -> ${raw} (no such file)`);
      continue;
    }
    if (insideDocs && !(resolved === docsDir || resolved.startsWith(docsDir + path.sep))) {
      problems.push(
        `${rel}: link escapes docs/ -> ${raw} (breaks on GitHub Pages; use a github.com/blob URL)`,
      );
    }
  }
}

if (problems.length) {
  console.error(`Link check failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('Link check passed: no dead or Pages-escaping relative links.');
