const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
const envFiles = [
  path.join(projectRoot, '.env.local'),
  path.join(projectRoot, '.env'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '.env'),
];

for (const envFile of envFiles) {
  dotenv.config({ path: envFile, override: false });
}

const app = require('./app');
const { connectDatabase } = require('./config/db');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 5000);

app.listen(port, host, () => {
  console.log(`[startup] Express API listening on http://${host}:${port}`);
  console.log('[startup] Waiting for required dependency checks to finish...');
});

connectDatabase()
  .then(() => {
    console.log('[startup] MongoDB connected successfully.');
  })
  .catch((error) => {
    console.error('[startup] MongoDB connection failed; the API remains available for local health checks.', {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown database error',
    });
  });
