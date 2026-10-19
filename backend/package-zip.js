const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const staging = path.resolve(__dirname, 'dist');
if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

const filesToCopy = [
  'index.js',
  'server.js',
  'cognito-auth.js',
  's3.js',
  'db.js',
  'auth.js',
  'authMiddleware.js',
  'auditTrail.js',
  'documentAuthorization.js',
  'session-auth.js',
  'session.js',
  'package.json'
];

for (const f of filesToCopy) {
  fs.copyFileSync(path.join(__dirname, f), path.join(staging, f));
}

console.log('Copying node_modules (excluding bcrypt and cache)...');
fs.cpSync(path.join(__dirname, 'node_modules'), path.join(staging, 'node_modules'), {
  recursive: true,
  filter: (src) => !src.includes('bcrypt') && !src.includes('.cache')
});

console.log('Compressing to backend-full.zip using tar.exe...');
const zipTarget = path.resolve(__dirname, 'backend-full.zip');
execSync(`tar -a -c -f "${zipTarget}" *`, { cwd: staging });

const stat = fs.statSync(zipTarget);
console.log('Successfully created:', zipTarget, '(' + (stat.size / 1024 / 1024).toFixed(2) + ' MB)');

fs.rmSync(staging, { recursive: true, force: true });
