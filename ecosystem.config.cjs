module.exports = {
  apps: [
    {
      name: 'document-scanner-server',
      cwd: __dirname,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: 3001,
        HTTPS_ENABLED: 'false',
        TRUST_PROXY: 'true',
        PUBLIC_HOST: 'scanner.tudominio.com',
        JSON_LIMIT: '15mb',
        SCANNER_ALLOWED_FRAME_ANCESTORS: 'https://app.tudominio.com',
        SCANNER_ALLOWED_ORIGINS: ''
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
