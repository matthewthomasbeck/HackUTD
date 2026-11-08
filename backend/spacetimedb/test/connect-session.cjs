const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const [uri, database, token] = process.argv.slice(2);
if (!uri || !database || !token) throw new Error('usage: connect-session <uri> <database> <token>');

const moduleRoot = path.resolve(__dirname, '..');
const bindingsRoot = path.resolve(moduleRoot, '../spacetimedb-bindings');
const outputRoot = path.join(moduleRoot, 'node_modules', '.generated-client-test');
fs.mkdirSync(outputRoot, { recursive: true });
process.on('exit', () => fs.rmSync(outputRoot, { recursive: true, force: true }));

function compileTree(sourceRoot, relative = '') {
  for (const entry of fs.readdirSync(path.join(sourceRoot, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) compileTree(sourceRoot, next);
    else if (entry.name.endsWith('.ts')) {
      const source = fs.readFileSync(path.join(sourceRoot, next), 'utf8');
      const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
      const destination = path.join(outputRoot, next.replace(/\.ts$/, '.js'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, output);
    }
  }
}

compileTree(bindingsRoot);
const { DbConnection } = require(path.join(outputRoot, 'index.js'));
let settled = false;
const connection = DbConnection.builder()
  .withUri(uri)
  .withDatabaseName(database)
  .withToken(token)
  .onConnect(() => {
    settled = true;
    process.stdout.write('CONNECTED\n');
  })
  .onConnectError((_ctx, error) => {
    settled = true;
    process.stderr.write(`CONNECT_ERROR ${error.message}\n`);
    process.exitCode = 1;
  })
  .build();

setTimeout(() => {
  if (!settled) process.exitCode = 1;
  connection.disconnect();
}, 60_000);
