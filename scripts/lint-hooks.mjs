import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

const placeholder = /^not implemented[.!]?$/i;
const placeholderDiagnostic = [
  '이 경로는 호출되면 미구현 오류를 던집니다.',
  'codebase-memory-mcp 또는 소스에서 호출 경로를 확인하고, 기대 결과를 내도록 빠진 동작을 구현하세요.',
  '해당 동작을 검증하는 테스트와 npm run lint를 다시 실행하세요.',
].join(' ');

export function lintHook(source) {
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return [{
      line: error.loc.line,
      column: error.loc.column + 1,
      message: `JavaScript 구문 오류. ${error.message}`,
    }];
  }

  const diagnostics = [];
  simple(ast, {
    ThrowStatement({ argument, loc }) {
      if (argument.type !== 'NewExpression' && argument.type !== 'CallExpression') return;
      if (argument.callee.type !== 'Identifier' || argument.callee.name !== 'Error') return;

      const [message] = argument.arguments;
      let value = message?.type === 'Literal' ? message.value : undefined;
      if (message?.type === 'TemplateLiteral' && message.expressions.length === 0) {
        value = message.quasis[0].value.cooked;
      }
      if (typeof value !== 'string' || !placeholder.test(value)) return;

      diagnostics.push({
        line: loc.start.line,
        column: loc.start.column + 1,
        message: placeholderDiagnostic,
      });
    },
  });
  return diagnostics;
}

function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const entries = readdirSync(join(root, 'hooks'), { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;

    const file = join(entry.parentPath, entry.name);
    const diagnostics = lintHook(readFileSync(file, 'utf8'));
    for (const { line, column, message } of diagnostics) {
      console.error(`${relative(root, file)}:${line}:${column} ${message}`);
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
