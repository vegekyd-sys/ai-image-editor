#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const sourceRoots = [
  path.join(repositoryRoot, 'src', 'app'),
  path.join(repositoryRoot, 'src', 'components'),
];
const baselinePath = path.join(repositoryRoot, 'scripts', 'ui-i18n-baseline.json');
const updateBaseline = process.argv.includes('--update-baseline');
const visibleAttributeNames = new Set(['alt', 'aria-label', 'placeholder', 'title']);
const visiblePropertyNames = /^(?:alt|ariaLabel|caption|description|emptyText|heading|label|message|name|placeholder|short|subtitle|text|title|tooltip)$/i;
const cjkPattern = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f]/u;
const humanTextPattern = /[\p{L}\p{N}]/u;
const translationKeyPattern = /^[a-z][\w-]*(?:\.[\w-]+)+$/;

function listTsxFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

function normalizeText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function propertyNameText(node) {
  if (!node) return '';
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return '';
}

function isImportLike(node) {
  let current = node.parent;
  while (current) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return true;
    if (ts.isStatement(current)) return false;
    current = current.parent;
  }
  return false;
}

function renderedLiteralNodes(expression) {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression];
  if (ts.isParenthesizedExpression(expression)) return renderedLiteralNodes(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    return [
      ...renderedLiteralNodes(expression.whenTrue),
      ...renderedLiteralNodes(expression.whenFalse),
    ];
  }
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return [...renderedLiteralNodes(expression.left), ...renderedLiteralNodes(expression.right)];
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return renderedLiteralNodes(expression.right);
    }
  }
  return [];
}

function scanFile(filePath, violations) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = sourceText.split(/\r?\n/);
  const relativePath = path.relative(repositoryRoot, filePath).replaceAll(path.sep, '/');
  const seenNodes = new Set();

  const isIgnored = (node) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
    return lines[line]?.includes('i18n-ignore') || lines[line - 1]?.includes('i18n-ignore');
  };

  const isBilingualChangelogData = (node) => {
    if (relativePath !== 'src/components/Changelog.tsx') return false;

    let current = node;
    while (current) {
      if (
        ts.isVariableDeclaration(current)
        && ts.isIdentifier(current.name)
        && current.name.text === 'CHANGELOG'
      ) {
        return true;
      }
      current = current.parent;
    }

    return false;
  };

  const record = (kind, rawText, node) => {
    const text = normalizeText(rawText);
    // Release notes intentionally keep their historical English/Chinese pair;
    // Japanese and Traditional Chinese locales use the English fallback.
    if (
      !text
      || !humanTextPattern.test(text)
      || translationKeyPattern.test(text)
      || isIgnored(node)
      || isBilingualChangelogData(node)
    ) return;
    const nodeKey = `${node.pos}:${node.end}:${kind}`;
    if (seenNodes.has(nodeKey)) return;
    seenNodes.add(nodeKey);
    const fingerprint = `${relativePath}|${kind}|${text}`;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const current = violations.get(fingerprint);
    if (current) {
      current.count += 1;
      current.lines.push(line);
    } else {
      violations.set(fingerprint, { count: 1, file: relativePath, kind, text, lines: [line] });
    }
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      record('jsx-text', node.text, node);
    }

    if (ts.isJsxAttribute(node)) {
      const attributeName = node.name.getText(sourceFile);
      if (visibleAttributeNames.has(attributeName) && node.initializer) {
        const directText = literalText(node.initializer);
        if (directText !== null) record(`jsx-attribute:${attributeName}`, directText, node.initializer);
        if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          for (const literal of renderedLiteralNodes(node.initializer.expression)) {
            record(`jsx-attribute:${attributeName}`, literalText(literal) ?? '', literal);
          }
        }
      }
    }

    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const literal of renderedLiteralNodes(node.expression)) {
        record('jsx-expression', literalText(literal) ?? '', literal);
      }
    }

    if (ts.isPropertyAssignment(node) && visiblePropertyNames.test(propertyNameText(node.name))) {
      const value = literalText(node.initializer);
      if (value !== null) record(`ui-property:${propertyNameText(node.name)}`, value, node.initializer);
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && visiblePropertyNames.test(node.name.text) && node.initializer) {
      const value = literalText(node.initializer);
      if (value !== null) record(`ui-variable:${node.name.text}`, value, node.initializer);
    }

    const value = literalText(node);
    if (value !== null && cjkPattern.test(value) && !isImportLike(node)) {
      record('cjk-literal', value, node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

const violations = new Map();
for (const filePath of sourceRoots.flatMap(listTsxFiles).sort()) {
  scanFile(filePath, violations);
}

const currentCounts = Object.fromEntries(
  [...violations.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fingerprint, violation]) => [fingerprint, violation.count]),
);

if (updateBaseline) {
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({
      version: 1,
      note: 'Existing UI literal debt. New product UI must use locale keys; do not add new baseline entries for feature work.',
      violations: currentCounts,
    }, null, 2)}\n`,
  );
  console.log(`Updated ${path.relative(repositoryRoot, baselinePath)} with ${violations.size} existing fingerprints.`);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing ${path.relative(repositoryRoot, baselinePath)}. Run this script once with --update-baseline.`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const allowedCounts = baseline.violations ?? {};
const regressions = [...violations.entries()].filter(([fingerprint, violation]) => (
  violation.count > (allowedCounts[fingerprint] ?? 0)
));

if (regressions.length > 0) {
  console.error('New hard-coded product UI text detected. Add locale keys for zh, zh-Hant, ja, and en instead:');
  for (const [, violation] of regressions.slice(0, 40)) {
    console.error(`- ${violation.file}:${violation.lines.join(',')} [${violation.kind}] ${JSON.stringify(violation.text)}`);
  }
  if (regressions.length > 40) console.error(`- …and ${regressions.length - 40} more`);
  console.error('Use an adjacent // i18n-ignore only for non-translatable brand names or technical tokens.');
  process.exit(1);
}

console.log(`UI i18n guard passed (${violations.size} known fingerprints, no new hard-coded UI text).`);
