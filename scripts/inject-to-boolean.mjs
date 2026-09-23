/**
 * Inserts @ToBoolean() immediately before every @IsBoolean() that does not already
 * have a boolean Transform on the same property (avoids double-wrapping).
 *
 * Usage: node scripts/inject-to-boolean.mjs
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src');

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function hasBooleanTransformAbove(lines, isBooleanLineIdx) {
  // Look upward until a blank line, class/function keyword, or property without decorator
  for (let i = isBooleanLineIdx - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('export ') || line.startsWith('class ') || line.startsWith('function ')) {
      break;
    }
    if (!line.startsWith('@') && !line.startsWith('/**') && !line.startsWith('*') && !line.startsWith('*/')) {
      // hit the previous property declaration
      if (i < isBooleanLineIdx - 1) break;
    }
    if (
      line.includes('@ToBoolean(') ||
      line.includes('toOptionalBoolean') ||
      line.includes('coerceBooleanInput') ||
      /@Transform\(\(\{\s*value\s*\}\)\s*=>\s*value\s*===\s*true/.test(line) ||
      /@Transform\(\(\{\s*value\s*\}\)\s*=>\s*\(value\s*===\s*true/.test(line)
    ) {
      return true;
    }
    // Stop when we leave this property's decorator block going up past another field
    if (
      !line.startsWith('@') &&
      !line.startsWith('*') &&
      !line.startsWith('/**') &&
      !line.startsWith('*/') &&
      line.includes(':') &&
      !line.includes('@IsBoolean')
    ) {
      break;
    }
  }
  return false;
}

function ensureImport(content) {
  if (content.includes("from '../../common/boolean.util'") ||
      content.includes("from '../common/boolean.util'") ||
      content.includes("from '../../../common/boolean.util'") ||
      content.includes("from './boolean.util'") ||
      content.includes('ToBoolean')) {
    // may still need import if ToBoolean was only in comments — check properly below
  }

  if (/\bToBoolean\b/.test(content) && /from ['"].*boolean\.util['"]/.test(content)) {
    return content;
  }
  if (!/\bToBoolean\b/.test(content)) return content;

  // Compute relative import from file to src/common/boolean.util
  // Handled per-file in processFile
  return content;
}

function relativeImport(fromFile) {
  const target = path.resolve('src/common/boolean.util');
  let rel = path.relative(path.dirname(fromFile), target).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function processFile(file) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('@IsBoolean')) return false;
  if (file.replace(/\\/g, '/').endsWith('common/boolean.util.ts')) return false;

  const lines = content.split('\n');
  let changed = false;
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Same-line: ... @IsBoolean() ...
    if (trimmed.includes('@IsBoolean(') || trimmed.includes('@IsBoolean()')) {
      if (trimmed.includes('@ToBoolean(') || trimmed.includes('toOptionalBoolean')) {
        out.push(line);
        continue;
      }
      if (hasBooleanTransformAbove(lines, i)) {
        out.push(line);
        continue;
      }
      // Inject on same line before @IsBoolean
      if (/@IsBoolean\(/.test(line)) {
        const next = line.replace(/@IsBoolean\(/, '@ToBoolean() @IsBoolean(');
        out.push(next);
        changed = true;
        continue;
      }
    }

    // Multiline: line is only @IsBoolean()
    if (trimmed === '@IsBoolean()' || trimmed === '@IsBoolean();') {
      if (hasBooleanTransformAbove(lines, i)) {
        out.push(line);
        continue;
      }
      const indent = line.match(/^\s*/)[0];
      out.push(`${indent}@ToBoolean()`);
      out.push(line);
      changed = true;
      continue;
    }

    out.push(line);
  }

  if (!changed) return false;

  let next = out.join('\n');
  if (!/from ['"].*boolean\.util['"]/.test(next)) {
    const imp = `import { ToBoolean } from '${relativeImport(file)}';\n`;
    // After last import
    const importBlock = next.match(/^(?:import[\s\S]*?;\r?\n)+/);
    if (importBlock) {
      next = next.slice(0, importBlock[0].length) + imp + next.slice(importBlock[0].length);
    } else {
      next = imp + next;
    }
  } else if (!/\bToBoolean\b/.test(next.match(/import\s*\{[^}]*\}\s*from\s*['"].*boolean\.util['"]/)?.[0] ?? '')) {
    next = next.replace(
      /import\s*\{([^}]*)\}\s*from\s*(['"].*boolean\.util['"])/,
      (m, names, from) => {
        const list = names.split(',').map((s) => s.trim()).filter(Boolean);
        if (!list.includes('ToBoolean')) list.push('ToBoolean');
        return `import { ${list.join(', ')} } from ${from}`;
      },
    );
  }

  fs.writeFileSync(file, next);
  return true;
}

const files = walk(SRC);
let n = 0;
for (const f of files) {
  if (processFile(f)) {
    n++;
    console.log('updated', path.relative(process.cwd(), f));
  }
}
console.log(`Done. ${n} files updated.`);
