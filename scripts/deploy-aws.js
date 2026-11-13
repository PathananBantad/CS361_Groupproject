const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('../backend/node_modules/dotenv');

const envPath = path.resolve(__dirname, '../backend/.env');
const envConfig = dotenv.config({ path: envPath }).parsed || {};

const env = {
  ...process.env,
  AWS_ACCESS_KEY_ID: envConfig.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: envConfig.AWS_SECRET_ACCESS_KEY,
  AWS_SESSION_TOKEN: envConfig.AWS_SESSION_TOKEN,
  AWS_REGION: envConfig.AWS_REGION || 'us-east-1'
};

// Origin ที่อนุญาตให้เรียก API/S3 (ตรงกับ backend/config.js) — ตั้งได้ด้วย CORS_ALLOWED_ORIGINS (คั่นด้วย ,)
const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'https://main.d29fui7wfvh5a0.amplifyapp.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];
const corsAllowedOrigins = (envConfig.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
const allowedOrigins = corsAllowedOrigins.length ? corsAllowedOrigins : DEFAULT_CORS_ALLOWED_ORIGINS;

function writeTempJson(name, data) {
  const filePath = path.resolve(__dirname, name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

function runAws(cmd, options = {}) {
  try {
    const res = execSync(cmd, { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
    try {
      return JSON.parse(res);
    } catch {
      return res;
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    const stdout = err.stdout ? err.stdout.toString() : '';
    throw new Error(`Command failed: ${cmd}\n${stderr || stdout || err.message}`);
  }
}

async function main() {
  console.log('=====================================================');
  console.log('DocuFlow AWS Services Setup & Deployment');
  console.log('=====================================================\n');

  if (!envConfig.LAMBDA_DB_HOST || !envConfig.LAMBDA_DB_SECRET_ARN || !envConfig.SESSION_SECRET) {
    throw new Error('Set LAMBDA_DB_HOST, LAMBDA_DB_SECRET_ARN, and SESSION_SECRET in backend/.env before deploying the Lambda.');
  }
  if (!envConfig.LAMBDA_SUBNET_IDS || !envConfig.LAMBDA_SECURITY_GROUP_IDS) {
    throw new Error('Set LAMBDA_SUBNET_IDS and LAMBDA_SECURITY_GROUP_IDS in backend/.env so the Lambda can reach RDS inside the VPC.');
  }

  // 1. Verify AWS Identity
  console.log('[1/8] Verifying AWS credentials and identity...');
  const identity = runAws('aws sts get-caller-identity');
  const accountId = identity.Account;
  console.log(` -> Connected as Account: ${accountId}`);
  console.log(` -> IAM Arn: ${identity.Arn}\n`);

  const s3BucketName = `cs361-v2-docuflow-${accountId}`;
  const lambdaFunctionName = 'cs361-v2-documentflow-api';
  const labRoleArn = `arn:aws:iam::${accountId}:role/LabRole`;
  const cognitoPoolId = envConfig.COGNITO_USER_POOL_ID || 'us-east-1_ySsGHRKUQ';
  const cognitoClientId = envConfig.COGNITO_APP_CLIENT_ID || '7onljgop56a811chbidtuppffq';

  // 2. Create S3 Bucket if it doesn't exist
  console.log(`[2/8] Setting up S3 Bucket: ${s3BucketName}...`);
  try {
    runAws(`aws s3api head-bucket --bucket ${s3BucketName}`);
    console.log(` -> Bucket ${s3BucketName} already exists.`);
  } catch (e) {
    console.log(` -> Bucket does not exist. Creating ${s3BucketName}...`);
    runAws(`aws s3api create-bucket --bucket ${s3BucketName} --region us-east-1`);
    console.log(` -> Bucket created successfully.`);
  }

  // 3. Configure S3 Bucket CORS
  console.log('[3/8] Configuring S3 Bucket CORS...');
  const corsRules = {
    CORSRules: [
      {
        AllowedHeaders: ['Content-Type', 'Authorization', 'x-amz-*'],
        AllowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
        AllowedOrigins: allowedOrigins,
        ExposeHeaders: ['ETag', 'Content-Length', 'Content-Type', 'Access-Control-Allow-Origin']
      }
    ]
  };
  const corsPath = path.resolve(__dirname, 's3-cors.json');
  fs.writeFileSync(corsPath, JSON.stringify(corsRules, null, 2));
  runAws(`aws s3api put-bucket-cors --bucket ${s3BucketName} --cors-configuration file://${corsPath}`);
  fs.unlinkSync(corsPath);
  console.log(` -> S3 CORS configured successfully.\n`);

  // 4. Package backend zip
  console.log('[4/8] Packaging backend for Lambda deployment...');
  const zipPath = path.resolve(__dirname, '../backend/backend-full.zip');
  // Always rebuild so the deployed code matches the working tree.
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const packageZipScript = path.resolve(__dirname, '../backend/package-zip.js');
  execSync(`node "${packageZipScript}"`, { cwd: path.resolve(__dirname, '../backend'), stdio: 'inherit' });
  console.log(` -> Zip package ready: ${zipPath}\n`);

  // 5. Create or Update Lambda Function
  console.log(`[5/8] Deploying Lambda Function: ${lambdaFunctionName}...`);
  const lambdaEnvVars = {
    Variables: {
      AWS_S3_REGION: 'us-east-1',
      S3_BUCKET: s3BucketName,
      DB_HOST: envConfig.LAMBDA_DB_HOST,
      DB_PORT: envConfig.LAMBDA_DB_PORT || '3306',
      DB_SECRET_ARN: envConfig.LAMBDA_DB_SECRET_ARN,
      DB_SSL: 'true',
      DB_TLS_SERVERNAME: envConfig.LAMBDA_DB_HOST,
      DB_NAME: envConfig.LAMBDA_DB_NAME || 'ems',
      NODE_ENV: 'production',
      SESSION_SECRET: envConfig.SESSION_SECRET,
      ...(envConfig.AUTH_JWT_SECRET ? { AUTH_JWT_SECRET: envConfig.AUTH_JWT_SECRET } : {}),
      CORS_ALLOWED_ORIGINS: allowedOrigins.join(','),
      COGNITO_REGION: 'us-east-1',
      COGNITO_USER_POOL_ID: cognitoPoolId,
      COGNITO_APP_CLIENT_ID: cognitoClientId,
      TU_API_URL: envConfig.TU_API_URL || 'https://restapi.tu.ac.th/api/v1/auth/Ad/verify',
      TU_API_KEY: envConfig.TU_API_KEY || ''
    }
  };
  const envJsonPath = path.resolve(__dirname, 'lambda-env.json');
  fs.writeFileSync(envJsonPath, JSON.stringify(lambdaEnvVars, null, 2));

  // RDS is reachable only inside the VPC; Lambda reaches the internet through the NAT Gateway.
  const vpcConfigArg = `--vpc-config SubnetIds=${envConfig.LAMBDA_SUBNET_IDS},SecurityGroupIds=${envConfig.LAMBDA_SECURITY_GROUP_IDS} `;

  let functionExists = false;
  try {
    runAws(`aws lambda get-function --function-name ${lambdaFunctionName}`);
    functionExists = true;
  } catch {}

  let lambdaArn = '';
  if (!functionExists) {
    console.log(` -> Creating new Lambda function ${lambdaFunctionName}...`);
    const createRes = runAws(
      `aws lambda create-function ` +
      `--function-name ${lambdaFunctionName} ` +
      `--runtime nodejs20.x ` +
      `--role ${labRoleArn} ` +
      `--handler index.handler ` +
      `--timeout 30 ` +
      `--memory-size 512 ` +
      `--zip-file fileb://${zipPath} ` +
      vpcConfigArg +
      `--environment file://${envJsonPath}`
    );
    lambdaArn = createRes.FunctionArn;
    console.log(` -> Lambda created. ARN: ${lambdaArn}`);
  } else {
    console.log(` -> Updating Lambda function code...`);
    runAws(`aws lambda update-function-code --function-name ${lambdaFunctionName} --zip-file fileb://${zipPath}`);
    runAws(`aws lambda wait function-updated --function-name ${lambdaFunctionName}`);
    console.log(` -> Updating Lambda function configuration...`);
    const updateRes = runAws(
      `aws lambda update-function-configuration ` +
      `--function-name ${lambdaFunctionName} ` +
      `--runtime nodejs20.x ` +
      `--handler index.handler ` +
      `--timeout 30 ` +
      `--memory-size 512 ` +
      vpcConfigArg +
      `--environment file://${envJsonPath}`
    );
    lambdaArn = updateRes.FunctionArn;
    console.log(` -> Lambda updated. ARN: ${lambdaArn}`);
  }
  fs.unlinkSync(envJsonPath);

  // Wait for function to be active
  console.log(' -> Waiting for Lambda update to finish...');
  runAws(`aws lambda wait function-updated --function-name ${lambdaFunctionName}`);
  console.log(' -> Lambda is ready and active.\n');

  // 6. Create / Configure Lambda Function URL
  console.log('[6/8] Configuring Lambda Function URL (Public HTTP Endpoint)...');
  // CORS ของ Function URL ตอบ OPTIONS preflight แทน Express (index.js ลบ CORS headers ของ Express ออก)
  const functionUrlCorsPath = writeTempJson('function-url-cors.json', {
    AllowOrigins: allowedOrigins,
    AllowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    AllowHeaders: ['content-type', 'authorization'],
    AllowCredentials: true,
    MaxAge: 600
  });
  let functionUrl = '';
  try {
    const urlConfig = runAws(`aws lambda get-function-url-config --function-name ${lambdaFunctionName}`);
    functionUrl = urlConfig.FunctionUrl;
    console.log(` -> Function URL already exists: ${functionUrl}`);
  } catch (e) {
    console.log(` -> Creating Function URL with CORS...`);
    const urlConfig = runAws(
      `aws lambda create-function-url-config ` +
      `--function-name ${lambdaFunctionName} ` +
      `--auth-type NONE ` +
      `--cors file://${functionUrlCorsPath}`
    );
    functionUrl = urlConfig.FunctionUrl;
    console.log(` -> Function URL created: ${functionUrl}`);
  }

  // Update CORS on Function URL to be sure
  runAws(
    `aws lambda update-function-url-config ` +
    `--function-name ${lambdaFunctionName} ` +
    `--auth-type NONE ` +
    `--cors file://${functionUrlCorsPath}`
  );
  fs.unlinkSync(functionUrlCorsPath);

  // Add permission for public Function URL invocation
  try {
    runAws(
      `aws lambda add-permission ` +
      `--function-name ${lambdaFunctionName} ` +
      `--statement-id FunctionURLAllowPublicAccess ` +
      `--action lambda:InvokeFunctionUrl ` +
      `--principal "*" ` +
      `--function-url-auth-type NONE`
    );
    console.log(' -> Added public invocation permission for Function URL.');
  } catch (e) {
    if (e.message.includes('ResourceConflictException')) {
      console.log(' -> Public invocation permission already present.');
    } else {
      console.warn(' -> Note on permission:', e.message);
    }
  }

  // Ensure trailing slash is removed for standard base URL format
  const cleanFunctionUrl = functionUrl.replace(/\/+$/, '');
  console.log(` -> Clean Function URL: ${cleanFunctionUrl}\n`);

  // 7. Configure Cognito PostAuthentication Trigger
  console.log(`[7/8] Configuring Cognito PostAuthentication Trigger on Pool ${cognitoPoolId}...`);
  // Add permission for Cognito to invoke Lambda
  try {
    runAws(
      `aws lambda add-permission ` +
      `--function-name ${lambdaFunctionName} ` +
      `--statement-id CognitoPostAuthInvokePermission ` +
      `--action lambda:InvokeFunction ` +
      `--principal cognito-idp.amazonaws.com ` +
      `--source-arn arn:aws:cognito-idp:us-east-1:${accountId}:userpool/${cognitoPoolId}`
    );
    console.log(' -> Added Cognito invoke permission to Lambda.');
  } catch (e) {
    if (e.message.includes('ResourceConflictException')) {
      console.log(' -> Cognito invoke permission already present.');
    } else {
      console.warn(' -> Note on Cognito permission:', e.message);
    }
  }

  // Link trigger in Cognito User Pool
  try {
    runAws(
      `aws cognito-idp update-user-pool ` +
      `--user-pool-id ${cognitoPoolId} ` +
      `--lambda-config "PostAuthentication=${lambdaArn}"`
    );
    console.log(` -> Cognito PostAuthentication trigger linked to ${lambdaFunctionName} successfully.`);
  } catch (e) {
    console.warn(` -> Warning updating Cognito trigger:`, e.message);
  }

  // 8. Update Frontend Configuration & Local Files
  console.log('\n[8/8] Updating frontend configuration and testing endpoints...');
  const frontendConfigPath = path.resolve(__dirname, '../frontend/js/cognito-config.js');
  let configContent = fs.readFileSync(frontendConfigPath, 'utf8');

  // Replace userPoolId, clientId, and AWS_API_GATEWAY_URL
  configContent = configContent.replace(/userPoolId:\s*"[^"]*"/, `userPoolId: "${cognitoPoolId}"`);
  configContent = configContent.replace(/clientId:\s*"[^"]*"/, `clientId: "${cognitoClientId}"`);
  configContent = configContent.replace(/window\.AWS_API_GATEWAY_URL\s*=\s*"[^"]*"/, `window.AWS_API_GATEWAY_URL = "${cleanFunctionUrl}"`);

  fs.writeFileSync(frontendConfigPath, configContent, 'utf8');
  console.log(` -> Updated ${frontendConfigPath}`);

  // Test Lambda Function URL health check
  console.log(`\nTesting Health Endpoint: ${cleanFunctionUrl}/api/health ...`);
  try {
    const healthRes = await fetch(`${cleanFunctionUrl}/api/health`);
    const healthJson = await healthRes.json();
    console.log(` -> Status: ${healthRes.status}`);
    console.log(` -> Response:`, JSON.stringify(healthJson, null, 2));
  } catch (err) {
    console.error(` -> Health check failed:`, err.message);
  }

  console.log('\n=====================================================');
  console.log('SUCCESS: All AWS services deployed and connected!');
  console.log('=====================================================');
  console.log(`Account ID:         ${accountId}`);
  console.log(`S3 Bucket:          ${s3BucketName}`);
  console.log(`Lambda Function:    ${lambdaFunctionName}`);
  console.log(`Lambda Function URL: ${cleanFunctionUrl}`);
  console.log(`Cognito User Pool:  ${cognitoPoolId}`);
  console.log(`Cognito Client ID:  ${cognitoClientId}`);
  console.log(`Amplify App URL:    https://main.d29fui7wfvh5a0.amplifyapp.com/html/dashboard.html`);
  console.log('=====================================================\n');
}

main().catch(err => {
  console.error('\nDeployment Error:', err);
  process.exit(1);
});
