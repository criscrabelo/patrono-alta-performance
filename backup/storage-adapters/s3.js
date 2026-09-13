// Sprint 2, Hardening H5 (docs/PRODUCTION_GATE.md, PG-21; docs/DECISIONS.md, PROD-H5-01): adapter de
// storage offsite S3-compatible (AWS S3 e qualquer provedor compatível via `endpoint` custom — MinIO,
// Backblaze B2, Cloudflare R2, etc.). Único adapter aceito em produção (item 21/53/54 do escopo H5).
//
// Usa `@aws-sdk/client-s3` (SDK oficial, modular — só o cliente S3 é importado, nunca o pacote monolítico
// v2) em vez de reimplementar a assinatura SigV4 manualmente: é a mesma justificativa já usada em
// `docs/DECISIONS.md` para não reinventar primitivas que uma biblioteca madura resolve com mais
// segurança. Nenhum bucket real é criado por este código — a criação de infraestrutura é H11 (item 53).
//
// Correção pós-H5 (revisão técnica independente): upload/download passaram a usar STREAMING real, nunca
// carregando o artefato inteiro em memória — `putObject()` envia `fs.createReadStream()` como `Body`
// (com `ContentLength` explícito, calculado só com `fs.statSync()` — nunca lendo o arquivo — para que o
// SDK não precise armazenar o stream inteiro em buffer para calcular o tamanho); `getObject()` usa
// `stream/promises`' `pipeline()` para escoar `response.Body` diretamente para o arquivo de destino, sem
// acumular chunks num array/Buffer. Limite conhecido (documentado em
// `docs/BACKUP_RESTORE_RUNBOOK.md`): um único `PutObject` tem limite de tamanho do provedor (5GB na AWS
// S3) — multipart upload é uma evolução futura, fora do escopo desta rodada dado o volume de dados atual.
//
// `client` é injetável (parâmetro opcional) especificamente para permitir testes unitários sem
// credenciais/rede reais (`tests/h5-backup-restore.test.js` injeta um cliente fake) — mesmo padrão já
// usado no projeto para repositórios (pool injetado) e para o cliente Postgres em scripts/migrate.js.
function createS3StorageAdapter({ bucket, region, endpoint, accessKeyId, secretAccessKey, forcePathStyle, client } = {}) {
  if (!bucket) throw new Error('BACKUP_BUCKET é obrigatória para o storage adapter "s3".');
  const s3Client = client || (() => {
    const { S3Client } = require('@aws-sdk/client-s3');
    return new S3Client({
      region: region || 'us-east-1',
      endpoint: endpoint || undefined,
      forcePathStyle: Boolean(forcePathStyle || endpoint),
      credentials: (accessKeyId && secretAccessKey) ? { accessKeyId, secretAccessKey } : undefined
    });
  })();

  async function putObject(objectKey, sourceFilePath) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const fs = require('node:fs');
    const { size } = fs.statSync(sourceFilePath);
    const body = fs.createReadStream(sourceFilePath);
    await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: body, ContentLength: size }));
    return { sizeBytes: size };
  }

  async function getObject(objectKey, destFilePath) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const fs = require('node:fs');
    const { pipeline } = require('node:stream/promises');
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    const output = fs.createWriteStream(destFilePath, { mode: 0o600 });
    await pipeline(response.Body, output);
    return { sizeBytes: fs.statSync(destFilePath).size };
  }

  async function objectExists(objectKey) {
    try {
      const { HeadObjectCommand } = require('@aws-sdk/client-s3');
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      return true;
    } catch (error) {
      if (error && (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404)) return false;
      throw error;
    }
  }

  return { provider: 's3', putObject, getObject, objectExists };
}

module.exports = { createS3StorageAdapter };
