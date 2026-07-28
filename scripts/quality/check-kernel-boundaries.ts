import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

type BoundaryFixture = {
  boundary: {
    canonicalWriteAuthority: string[];
  };
};

type Violation = {
  file: string;
  line: number;
  table: string;
  text: string;
};

const rootDir = process.cwd();
const fixturePath = join(rootDir, 'tests/contracts/w1-kernel-boundary-fixtures.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as BoundaryFixture;
const allowlistedWriters = new Set(
  fixture.boundary?.canonicalWriteAuthority?.map((entry) => normalizePath(entry)) ?? [],
);

const writeTargetPattern = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+("?(?:records|record_relations|operations)"?)/gi;
const dynamicWriteTargetPattern = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+\$\{/;
const executablePattern = /\.(?:runAsync|execAsync)\s*\(/g;
const writeTargets = ['records', 'record_relations', 'operations'];
const scanRoots = [join(rootDir, 'src'), join(rootDir, 'server/src')];
const excludeDirs = new Set(['node_modules', 'dist', '.expo', '.turbo', 'coverage', '.git']);
const violations: Violation[] = [];
const foundWriteOwners = new Map<string, Map<string, number>>();

let scanned = 0;

for (const root of scanRoots) {
  if (!exists(root)) continue;
  scan(root);
}

for (const [file, tables] of foundWriteOwners.entries()) {
  if (!allowlistedWriters.has(file)) {
    for (const [table, line] of tables.entries()) {
      violations.push({
        file,
        line,
        table,
        text: `unlisted canonical write owner (table ${table})`,
      });
    }
  }
}

for (const writer of allowlistedWriters) {
  if (!foundWriteOwners.has(writer)) {
    violations.push({
      file: writer,
      line: 1,
      table: 'records',
      text: 'listed writer does not perform canonical writes in scan',
    });
  }
}

if (violations.length > 0) {
  console.error('Kernel boundary check failed: canonical write authority violations');
  for (const violation of violations) {
    const lineSuffix = violation.line > 1 ? `:${violation.line}` : '';
    console.error(`  - ${violation.file}${lineSuffix} (${violation.table}) ${violation.text}`);
  }
  process.exit(1);
}

console.log(`Kernel boundaries passed: scanned ${scanned} files`);
console.log(`Canonical write owners: ${foundWriteOwners.size}`);
console.log(`Allowlisted canonical writers: ${allowlistedWriters.size}`);

function scan(directory: string) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      scan(join(directory, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
    if (directory.includes('/tests/')) continue;

    const absoluteFile = join(directory, entry.name);
    const relativeFile = normalizePath(relative(rootDir, absoluteFile));
    const text = readFileSync(absoluteFile, 'utf8');
    scanned += 1;
    const hitTables = findExecutableWrites(text);

    if (hitTables.size > 0) {
      foundWriteOwners.set(relativeFile, hitTables);
    }
  }
}

function findExecutableWrites(text: string): Map<string, number> {
  const lineStarts = buildLineStarts(text);
  const tables = new Map<string, number>();

  for (const match of text.matchAll(executablePattern)) {
    if (match.index === undefined) continue;
    const argsStart = skipWhitespace(text, match.index + match[0].length);
    const statement = parseSqlArgument(text, argsStart);
    if (!statement) continue;

    const matches = [...statement.sql.matchAll(writeTargetPattern)];
    for (const writeMatch of matches) {
      const table = normalizeTable(writeMatch[1]);
      if (!writeTargets.includes(table)) continue;
      const line = offsetToLine(statement.startOffset, lineStarts);
      const existing = tables.get(table);
      if (existing === undefined || existing > line) {
        tables.set(table, line);
      }
    }

    if (matches.length === 0 && dynamicWriteTargetPattern.test(statement.sql)) {
      const line = offsetToLine(statement.startOffset, lineStarts);
      for (const table of writeTargets) {
        const existing = tables.get(table);
        if (existing === undefined || existing > line) {
          tables.set(table, line);
        }
      }
    }
  }

  return tables;
}

function parseSqlArgument(text: string, start: number): { sql: string; startOffset: number } | null {
  if (start >= text.length) return null;
  const quote = text[start];
  if (quote !== '"' && quote !== '\'' && quote !== '`') return null;

  let index = start + 1;
  const chunks: string[] = [];
  let escaped = false;

  while (index < text.length) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      chunks.push(char);
      index += 1;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      index += 1;
      continue;
    }

    if (quote !== '`' && char === quote) {
      return { sql: chunks.join(''), startOffset: start };
    }

    if (quote === '`' && char === '`') {
      return { sql: chunks.join(''), startOffset: start };
    }

    if (quote === '`' && char === '$' && text[index + 1] === '{') {
      chunks.push('${...}');
      index += 2;
      let depth = 1;
      while (index < text.length && depth > 0) {
        if (text[index] === '{') depth += 1;
        if (text[index] === '}') depth -= 1;
        index += 1;
      }
      continue;
    }

    chunks.push(char);
    index += 1;
  }

  return null;
}

function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      index = text.indexOf('\n', index + 2);
      if (index === -1) return text.length;
      index += 1;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      if (end === -1) return text.length;
      index = end + 2;
      continue;
    }
    return index;
  }
  return index;
}

function buildLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(offset: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;
  let line = 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const start = lineStarts[middle];
    if (start <= offset) {
      line = middle + 1;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return line;
}

function normalizePath(path: string) {
  return relative(rootDir, resolve(rootDir, path)).replaceAll('\\', '/');
}

function normalizeTable(name: string) {
  return name.replaceAll('"', '').toLowerCase();
}

function exists(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
