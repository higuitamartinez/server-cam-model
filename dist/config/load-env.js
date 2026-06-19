import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { projectRoot } from './runtime-paths.js';
const explicitEnvFile = process.env.ENV_FILE;
const environmentName = process.env.NODE_ENV;
const candidateFiles = [
    explicitEnvFile,
    environmentName ? `.env.${environmentName}` : undefined,
    '.env'
].filter((value) => Boolean(value));
for (const candidate of candidateFiles) {
    const resolvedPath = path.isAbsolute(candidate)
        ? candidate
        : path.resolve(projectRoot, candidate);
    if (!fs.existsSync(resolvedPath))
        continue;
    loadEnv({ path: resolvedPath });
    break;
}
