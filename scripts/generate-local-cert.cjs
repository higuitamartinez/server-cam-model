const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const selfsigned = require('selfsigned');

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const certsDir = path.join(rootDir, 'certs');
  const keyPath = path.join(certsDir, 'scanner-key.pem');
  const certPath = path.join(certsDir, 'scanner-cert.pem');
  const envPath = path.join(rootDir, '.env');

  const env = readEnv(envPath);
  const publicHost = env.PUBLIC_HOST || getLanIp() || '192.168.1.30';

  fs.mkdirSync(certsDir, { recursive: true });

  const attrs = [
    { name: 'commonName', value: publicHost }
  ];

  const cert = await selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', keyCertSign: false, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 7, ip: publicHost },
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  });

  fs.writeFileSync(keyPath, cert.private, 'utf8');
  fs.writeFileSync(certPath, cert.cert, 'utf8');

  console.log(`Certificado HTTPS generado para ${publicHost}`);
  console.log(`Key: ${path.relative(rootDir, keyPath)}`);
  console.log(`Cert: ${path.relative(rootDir, certPath)}`);
}

function readEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) return acc;

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        return address.address;
      }
    }
  }

  return null;
}
