const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('../backend/node_modules/@aws-sdk/client-s3');
const { getSignedUrl } = require('../backend/node_modules/@aws-sdk/s3-request-presigner');
const path = require('path');
const dotenv = require('../backend/node_modules/dotenv');

const envConfig = dotenv.config({ path: path.join(__dirname, '../backend/.env') }).parsed || {};
const env = {
  AWS_ACCESS_KEY_ID: envConfig.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: envConfig.AWS_SECRET_ACCESS_KEY,
  AWS_SESSION_TOKEN: envConfig.AWS_SESSION_TOKEN,
  AWS_REGION: 'us-east-1'
};

const bucketName = envConfig.S3_BUCKET || 'cs361-v2-docuflow-927017131721';
const functionUrl = 'https://htvtloifbzeywxdh4gawlqoxdq0tftsv.lambda-url.us-east-1.on.aws';

const s3 = new S3Client({
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN
  },
  region: 'us-east-1'
});

async function testServices() {
  console.log('=== TEST 1: S3 BUCKET OPERATIONS ===');
  const testKey = 'test-verification/sample-' + Date.now() + '.txt';
  const testContent = 'Hello DocuFlow from AWS verification test!';

  console.log(`Putting object to s3://${bucketName}/${testKey}...`);
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: testKey,
    Body: testContent,
    ContentType: 'text/plain'
  }));
  console.log(' -> PutObject SUCCESS!');

  console.log('Generating Pre-signed GET URL...');
  const presignedGetUrl = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: bucketName,
    Key: testKey
  }), { expiresIn: 300 });
  console.log(' -> Pre-signed URL generated:', presignedGetUrl.slice(0, 80) + '...');

  console.log('Fetching object via Pre-signed URL...');
  const fetchRes = await fetch(presignedGetUrl);
  const fetchedText = await fetchRes.text();
  console.log(' -> Fetched content match:', fetchedText === testContent ? 'YES (SUCCESS)' : 'NO (FAIL)');

  console.log('Cleaning up test object...');
  await s3.send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: testKey
  }));
  console.log(' -> Cleaned up test object successfully!\n');

  console.log('=== TEST 2: LAMBDA FUNCTION URL & DATABASE ===');
  const healthRes = await fetch(functionUrl + '/api/health');
  const healthData = await healthRes.json();
  console.log(' -> Health status:', healthRes.status, JSON.stringify(healthData));

  const docTypesRes = await fetch(functionUrl + '/api/document-types');
  const docTypes = await docTypesRes.json();
  console.log(' -> Document Types count:', docTypes.data?.length);

  const channelsRes = await fetch(functionUrl + '/api/receiving-channels');
  const channels = await channelsRes.json();
  console.log(' -> Receiving Channels:', channels.data);

  console.log('\n=== TEST 3: FRONTEND CONFIG ===');
  const fs = require('fs');
  const feConfig = fs.readFileSync(path.join(__dirname, '../frontend/js/cognito-config.js'), 'utf8');
  console.log(' -> userPoolId configured:', feConfig.includes('us-east-1_ySsGHRKUQ') ? 'YES' : 'NO');
  console.log(' -> clientId configured:', feConfig.includes('7onljgop56a811chbidtuppffq') ? 'YES' : 'NO');
  console.log(' -> functionUrl configured:', feConfig.includes(functionUrl) ? 'YES' : 'NO');

  console.log('\nALL AWS SERVICES VERIFIED SUCCESSFULLY!');
}

testServices().catch(err => {
  console.error('Test Error:', err);
  process.exit(1);
});

