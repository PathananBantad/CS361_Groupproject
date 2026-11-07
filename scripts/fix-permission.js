const { execSync } = require('child_process');
const path = require('path');
const dotenv = require('../backend/node_modules/dotenv');

const envConfig = dotenv.config({ path: path.join(__dirname, '../backend/.env') }).parsed || {};
const env = {
  ...process.env,
  AWS_ACCESS_KEY_ID: envConfig.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: envConfig.AWS_SECRET_ACCESS_KEY,
  AWS_SESSION_TOKEN: envConfig.AWS_SESSION_TOKEN,
  AWS_REGION: 'us-east-1'
};

function run(cmd) {
  try {
    const res = execSync(cmd, { env, encoding: 'utf8' });
    console.log(res);
  } catch (err) {
    console.error('Error:', err.stderr ? err.stderr.toString() : err.message);
  }
}

console.log('Adding lambda:InvokeFunction permission...');
run('aws lambda add-permission --function-name cs361-v2-documentflow-api --statement-id FunctionURLAllowPublicInvoke --action lambda:InvokeFunction --principal *');

console.log('\nTesting Health URL...');
setTimeout(async () => {
  try {
    const r = await fetch('https://htvtloifbzeywxdh4gawlqoxdq0tftsv.lambda-url.us-east-1.on.aws/api/health');
    console.log('Status:', r.status);
    console.log('Body:', await r.text());
  } catch (e) {
    console.error('Fetch err:', e.message);
  }
}, 2000);

