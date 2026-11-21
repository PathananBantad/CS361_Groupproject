const { execFileSync } = require("node:child_process");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require("../backend/node_modules/@aws-sdk/client-s3");
const { getSignedUrl } = require("../backend/node_modules/@aws-sdk/s3-request-presigner");

const PROTECTED_V2_BUCKET_PREFIX = "cs361-v2-";
// The legacy V2 endpoint is recognizable by its immutable Lambda URL ID. Match
// the ID independently of region/scheme/path normalization.
const PROTECTED_V2_FUNCTION_URL_ID = "htvtloifbzeywxdh4gawlqoxdq0tftsv";
const ALLOWED_ENVIRONMENTS = new Set(["dev", "staging", "production"]);

function getVerificationConfig(environment = process.env) {
  const environmentName = environment.DEPLOY_ENVIRONMENT;
  const region = environment.AWS_REGION;
  const expectedAccountId = environment.AWS_EXPECTED_ACCOUNT_ID;
  const bucketName = environment.V5_VERIFY_S3_BUCKET;
  const rawFunctionUrl = environment.V5_VERIFY_FUNCTION_URL;

  if (!ALLOWED_ENVIRONMENTS.has(environmentName)) {
    throw new Error("DEPLOY_ENVIRONMENT must be dev, staging, or production.");
  }
  if (!region || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region)) {
    throw new Error("AWS_REGION must be configured as a valid AWS region.");
  }
  if (!expectedAccountId || !/^\d{12}$/.test(expectedAccountId)) {
    throw new Error("AWS_EXPECTED_ACCOUNT_ID must be a 12-digit AWS account ID.");
  }
  if (!bucketName || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error("V5_VERIFY_S3_BUCKET must be an explicit valid S3 bucket name.");
  }
  if (bucketName.startsWith(PROTECTED_V2_BUCKET_PREFIX)) {
    throw new Error("Verification refuses the protected V2 S3 bucket namespace.");
  }

  let functionUrl;
  try {
    functionUrl = new URL(rawFunctionUrl);
  } catch {
    throw new Error("V5_VERIFY_FUNCTION_URL must be an explicit HTTPS Lambda Function URL.");
  }
  if (functionUrl.hostname.startsWith(`${PROTECTED_V2_FUNCTION_URL_ID}.lambda-url.`)) {
    throw new Error("Verification refuses the protected V2 Lambda Function URL.");
  }
  const functionUrlSuffix = `.lambda-url.${region}.on.aws`;
  if (functionUrl.protocol !== "https:" ||
      !functionUrl.hostname.endsWith(functionUrlSuffix) ||
      functionUrl.hostname.length <= functionUrlSuffix.length ||
      functionUrl.pathname !== "/" || functionUrl.search || functionUrl.hash) {
    throw new Error("V5_VERIFY_FUNCTION_URL must be a regional Lambda Function URL matching AWS_REGION.");
  }
  const normalizedFunctionUrl = functionUrl.origin;

  return { environmentName, region, expectedAccountId, bucketName, functionUrl: normalizedFunctionUrl };
}

function verifyCallerAccount(config, run = args => execFileSync("aws", args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
})) {
  let accountId;
  try {
    accountId = run([
      "sts", "get-caller-identity",
      "--region", config.region,
      "--query", "Account",
      "--output", "text"
    ]).trim();
  } catch {
    throw new Error("Unable to verify AWS caller account; no service checks were run.");
  }
  if (accountId !== config.expectedAccountId) {
    throw new Error("AWS caller account does not match AWS_EXPECTED_ACCOUNT_ID; no service checks were run.");
  }
}

async function testServices(config = getVerificationConfig(), dependencies = {}) {
  const checkAccount = dependencies.verifyCallerAccount || verifyCallerAccount;
  checkAccount(config);
  const createS3Client = dependencies.createS3Client || (options => new S3Client(options));
  const presign = dependencies.getSignedUrl || getSignedUrl;
  const request = dependencies.fetch || fetch;
  const s3 = createS3Client({ region: config.region });
  const testKey = `test-verification/${config.environmentName}/${Date.now()}-${process.pid}.txt`;
  const testContent = "DocuFlow V5 AWS verification test";
  let objectCreated = false;
  let operationError;

  try {
    await s3.send(new PutObjectCommand({
      Bucket: config.bucketName,
      Key: testKey,
      Body: testContent,
      ContentType: "text/plain"
    }));
    objectCreated = true;

    const presignedGetUrl = await presign(s3, new GetObjectCommand({
      Bucket: config.bucketName,
      Key: testKey
    }), { expiresIn: 300 });
    const fetchResponse = await request(presignedGetUrl);
    const fetchedText = await fetchResponse.text();
    if (!fetchResponse.ok || fetchedText !== testContent) {
      throw new Error("S3 read-back verification failed.");
    }
    console.log(`S3 verification passed for s3://${config.bucketName}/${testKey}`);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (objectCreated) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: config.bucketName, Key: testKey }));
        console.log("S3 verification object cleaned up.");
      } catch {
        if (!operationError) throw new Error(`Unable to clean up verification object ${testKey}.`);
        console.error(`S3 verification cleanup failed for ${testKey}.`);
      }
    }
  }

  const healthResponse = await request(`${config.functionUrl}/api/health`, {
    signal: AbortSignal.timeout(15000)
  });
  const healthData = await healthResponse.json();
  if (!healthResponse.ok || healthData?.ok !== true || healthData?.database !== "connected") {
    throw new Error(`V5 Lambda health check failed (HTTP ${healthResponse.status}).`);
  }
  console.log(`V5 ${config.environmentName} Lambda health check passed.`);
}

if (require.main === module) {
  testServices().catch(error => {
    console.error("V5 service verification failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { getVerificationConfig, testServices, verifyCallerAccount };
