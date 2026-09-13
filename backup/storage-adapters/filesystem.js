// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): adapter de
// storage "offsite" para filesystem local — existe explicitamente como um stand-in de
// desenvolvimento/teste (item 21 do escopo H5), NUNCA como destino de produção: `/data/backups`, `/tmp`
// ou qualquer disco local da mesma VM/processo do Patrono não são "offsite" — um incidente que destrua o
// filesystem também destruiria o backup. `createStorageAdapter()` (`../storage-adapter.js`) recusa
// construir este adapter quando o ambiente resolvido é produção.
const fs = require('node:fs');
const path = require('node:path');

function createFilesystemStorageAdapter({ baseDir }) {
  if (!baseDir) throw new Error('BACKUP_LOCAL_DIR é obrigatória para o storage adapter "filesystem".');
  fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });

  function resolveObjectPath(objectKey) {
    // Nunca permite que um objectKey escape do diretório base (ex.: "../../etc/passwd") — mesma
    // disciplina de qualquer caminho derivado de um valor que, em tese, poderia ser manipulado.
    const resolved = path.resolve(baseDir, objectKey);
    if (!resolved.startsWith(path.resolve(baseDir) + path.sep) && resolved !== path.resolve(baseDir)) {
      throw new Error('objectKey inválido: fora do diretório de storage configurado.');
    }
    return resolved;
  }

  async function putObject(objectKey, sourceFilePath) {
    const destPath = resolveObjectPath(objectKey);
    fs.mkdirSync(path.dirname(destPath), { recursive: true, mode: 0o700 });
    fs.copyFileSync(sourceFilePath, destPath);
    const { size } = fs.statSync(destPath);
    return { sizeBytes: size };
  }

  async function getObject(objectKey, destFilePath) {
    const sourcePath = resolveObjectPath(objectKey);
    if (!fs.existsSync(sourcePath)) throw new Error(`Objeto não encontrado no storage local: ${objectKey}`);
    fs.copyFileSync(sourcePath, destFilePath);
    return { sizeBytes: fs.statSync(destFilePath).size };
  }

  async function objectExists(objectKey) {
    try { return fs.existsSync(resolveObjectPath(objectKey)); } catch { return false; }
  }

  return { provider: 'filesystem', putObject, getObject, objectExists };
}

module.exports = { createFilesystemStorageAdapter };
