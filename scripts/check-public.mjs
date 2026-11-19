import { readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const publicDir = "public";
const files = readdirSync(publicDir)
  .filter((name) => name.endsWith(".js"))
  .sort()
  .map((name) => join(publicDir, name));

const program = ts.createProgram(files, {
  allowJs: true,
  checkJs: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  allowUnreachableCode: false,
  noUnusedLocals: true,
});

const trackedCodes = new Set([
  2300, // Duplicate identifier
  2304, // Cannot find name
  2305, // Module has no exported member
  2448, // Block-scoped variable used before its declaration (TDZ)
  2451, // Cannot redeclare block-scoped variable
  2454, // Variable is used before being assigned
  2552, // Cannot find name (did you mean...)
  2554, // Expected N arguments, but got M
  2614, // Module has no exported member (default)
  6133, // Declared but never read
  6192, // All imports in import declaration are unused
  7027, // Unreachable code detected
]);

const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter((diag) => diag.code < 2000 || trackedCodes.has(diag.code));

if (diagnostics.length > 0) {
  for (const diag of diagnostics) {
    const pos = diag.file ? diag.file.getLineAndCharacterOfPosition(diag.start ?? 0) : { line: 0, character: 0 };
    const location = diag.file ? `${diag.file.fileName}:${pos.line + 1}:${pos.character + 1}` : "<unknown>";
    console.error(`${location} TS${diag.code}: ${ts.flattenDiagnosticMessageText(diag.messageText, " ")}`);
  }
  console.error(`\nEncontrados ${diagnostics.length} problema(s) em public/*.js.`);
  process.exit(1);
}

console.log(`check-public: OK (${files.length} arquivos verificados sem erros).`);
