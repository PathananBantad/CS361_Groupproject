const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dotenv = require("../backend/node_modules/dotenv");
const { createPackage } = require("../backend/package-zip");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const BACKEND_ROOT = path.join(REPOSITORY_ROOT, "backend");
const CLOUDFORMATION_ROOT = path.join(REPOSITORY_ROOT, "infra", "cloudformation");
const ENVIRONMENTS = new Set(["dev", "staging", "production"]);
const PROTECTED_V2_LAMBDA_NAME = "cs361-v2-documentflow-api";
const READY_STACK_STATUSES = new Set([
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "UPDATE_ROLLBACK_COMPLETE",
  "IMPORT_COMPLETE"
]);

function loadDeploymentConfig(environment = process.env) {
  const envPath = path.join(BACKEND_ROOT, ".env");
  const envFile = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath))
    : {};

  return { ...envFile, ...environment };
}

function getFirstConfiguredValue(...values) {
  return values.find(value => typeof value === "string" && value.trim());
}

function parseVpcResourceIds(value, variableName, prefix, minimumCount) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${variableName} must be configured for the target environment.`);
  }
  const resourceIds = value.split(",").map(resourceId => resourceId.trim()).filter(Boolean);
  if (resourceIds.length < minimumCount ||
      new Set(resourceIds).size !== resourceIds.length ||
      resourceIds.some(resourceId =>
        !new RegExp(`^${prefix}-(?:[0-9a-f]{8}|[0-9a-f]{17})$`).test(resourceId)
      )) {
    throw new Error(
      `${variableName} must contain at least ${minimumCount} valid ${prefix} resource ID(s).`
    );
  }
  return resourceIds;
}

function getRequiredDatabaseConfig(config) {
  const databaseConfig = {
    DB_HOST: getFirstConfiguredValue(config.DB_HOST),
    DB_PORT: getFirstConfiguredValue(config.DB_PORT),
    DB_USER: getFirstConfiguredValue(config.DB_USER, config.DB_USERNAME),
    DB_PASSWORD: getFirstConfiguredValue(config.DB_PASSWORD),
    DB_NAME: getFirstConfiguredValue(config.DB_NAME, config.DB_DATABASE)
  };
  const missingVariables = Object.entries(databaseConfig)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (missingVariables.length > 0) {
    throw new Error(`Database deployment configuration is incomplete: ${missingVariables.join(", ")}.`);
  }

  const port = Number(databaseConfig.DB_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DB_PORT must be an integer between 1 and 65535.");
  }

  return {
    ...databaseConfig,
    DB_PORT: String(port),
    DB_USERNAME: databaseConfig.DB_USER,
    DB_DATABASE: databaseConfig.DB_NAME
  };
}

function getRequiredSessionSecret(config) {
  const sessionSecret = config.SESSION_SECRET;
  if (typeof sessionSecret !== "string" || !sessionSecret.trim()) {
    throw new Error("SESSION_SECRET must be configured before deployment.");
  }
  return sessionSecret;
}

function parseAllowedOrigins(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("FRONTEND_ALLOWED_ORIGINS must contain at least one frontend origin.");
  }

  const origins = [...new Set(value.split(",").map(origin => origin.trim()).filter(Boolean))];
  if (origins.length === 0 || origins.some(origin => {
    try {
      const parsed = new URL(origin);
      return !["https:", "http:"].includes(parsed.protocol) ||
        parsed.origin !== origin ||
        (parsed.protocol === "http:" && !["localhost", "127.0.0.1"].includes(parsed.hostname));
    } catch {
      return true;
    }
  })) {
    throw new Error("FRONTEND_ALLOWED_ORIGINS must contain valid HTTPS origins (HTTP is limited to localhost).");
  }

  return origins;
}

function getRequiredDeploymentConfig(config) {
  const environmentName = getFirstConfiguredValue(config.DEPLOY_ENVIRONMENT) || "dev";
  if (!ENVIRONMENTS.has(environmentName)) {
    throw new Error(`DEPLOY_ENVIRONMENT must be one of: ${[...ENVIRONMENTS].join(", ")}.`);
  }

  const region = getFirstConfiguredValue(config.AWS_REGION, config.AWS_DEFAULT_REGION);
  if (!region || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region)) {
    throw new Error("AWS_REGION must be configured as a valid AWS region.");
  }

  const expectedAccountId = getFirstConfiguredValue(config.AWS_EXPECTED_ACCOUNT_ID);
  if (!expectedAccountId || !/^\d{12}$/.test(expectedAccountId)) {
    throw new Error("AWS_EXPECTED_ACCOUNT_ID must be configured as a 12-digit AWS account ID.");
  }

  const userPoolId = getFirstConfiguredValue(config.COGNITO_USER_POOL_ID);
  const appClientId = getFirstConfiguredValue(config.COGNITO_APP_CLIENT_ID);
  if (!userPoolId || !appClientId) {
    throw new Error("COGNITO_USER_POOL_ID and COGNITO_APP_CLIENT_ID must be configured.");
  }

  const cognitoRegion = getFirstConfiguredValue(config.COGNITO_REGION) || userPoolId.split("_")[0];
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(cognitoRegion)) {
    throw new Error("COGNITO_REGION must be a valid AWS region.");
  }

  const stackName = getFirstConfiguredValue(config.CLOUDFORMATION_STACK_NAME) ||
    `docuflow-${environmentName}`;
  if (!/^[A-Za-z][A-Za-z0-9-]{0,116}$/.test(stackName)) {
    throw new Error("CLOUDFORMATION_STACK_NAME must be valid and leave room for the -artifacts stack suffix.");
  }

  const artifactBucketName = getFirstConfiguredValue(config.ARTIFACT_BUCKET_NAME);
  const documentBucketName = getFirstConfiguredValue(config.DOCUMENT_BUCKET_NAME, config.S3_BUCKET);
  const lambdaFunctionName = getFirstConfiguredValue(config.LAMBDA_FUNCTION_NAME) ||
    `docuflow-${environmentName}-api`;
  const documentBucketMode = getFirstConfiguredValue(config.DOCUMENT_BUCKET_MODE) || "Existing";
  if (!artifactBucketName) {
    throw new Error("ARTIFACT_BUCKET_NAME must be configured.");
  }
  if (!documentBucketName) {
    throw new Error("DOCUMENT_BUCKET_NAME (or S3_BUCKET) must be configured.");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(lambdaFunctionName)) {
    throw new Error("LAMBDA_FUNCTION_NAME must contain only letters, numbers, hyphens, or underscores.");
  }
  if (lambdaFunctionName === PROTECTED_V2_LAMBDA_NAME) {
    throw new Error(`LAMBDA_FUNCTION_NAME cannot target the protected V2 Lambda ${PROTECTED_V2_LAMBDA_NAME}.`);
  }
  if (!["Existing", "Create"].includes(documentBucketMode)) {
    throw new Error("DOCUMENT_BUCKET_MODE must be Existing or Create.");
  }

  const lambdaRoleArn = getFirstConfiguredValue(config.LAMBDA_ROLE_ARN) || "";
  if (lambdaRoleArn && !/^arn:aws[a-z-]*:iam::\d{12}:role\/[\w+=,.@\/-]+$/.test(lambdaRoleArn)) {
    throw new Error("LAMBDA_ROLE_ARN must be an IAM role ARN.");
  }

  const databaseConfig = getRequiredDatabaseConfig(config);
  const sessionSecret = getRequiredSessionSecret(config);

  return {
    environmentName,
    region,
    stackName,
    artifactStackName: `${stackName}-artifacts`,
    artifactBucketName,
    lambdaFunctionName,
    documentBucketName,
    documentBucketMode,
    documentBucketRegion: getFirstConfiguredValue(config.AWS_S3_REGION) || region,
    cognitoRegion,
    userPoolId,
    appClientId,
    cognitoClientSecret: config.COGNITO_CLIENT_SECRET || "",
    databaseConfig,
    sessionSecret,
    tuApiUrl: getFirstConfiguredValue(config.TU_API_URL) ||
      "https://restapi.tu.ac.th/api/v1/auth/Ad/verify",
    tuApiKey: config.TU_API_KEY || config.TU_APP_KEY || "",
    allowedOrigins: parseAllowedOrigins(config.FRONTEND_ALLOWED_ORIGINS),
    expectedAccountId,
    lambdaRoleArn,
    vpcSubnetIds: parseVpcResourceIds(
      config.VPC_SUBNET_IDS,
      "VPC_SUBNET_IDS",
      "subnet",
      2
    ),
    vpcSecurityGroupIds: parseVpcResourceIds(
      config.VPC_SECURITY_GROUP_IDS,
      "VPC_SECURITY_GROUP_IDS",
      "sg",
      1
    )
  };
}

function createAwsEnvironment(config, baseEnvironment = process.env) {
  const awsEnvironment = { ...baseEnvironment };
  const region = getFirstConfiguredValue(config.AWS_REGION, config.AWS_DEFAULT_REGION);
  if (region) {
    awsEnvironment.AWS_REGION = region;
    awsEnvironment.AWS_DEFAULT_REGION = region;
  }
  return awsEnvironment;
}

function runAws(args, options = {}) {
  const result = spawnSync("aws", args, {
    cwd: REPOSITORY_ROOT,
    env: options.env || createAwsEnvironment(options.config || {}),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    throw new Error(`AWS CLI ${args.slice(0, 2).join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
    throw new Error(`AWS CLI ${args.slice(0, 2).join(" ")} failed: ${message}`);
  }
  return (result.stdout || "").trim();
}

function verifyAwsIdentity(executeAws, awsEnvironment, expectedAccountId) {
  const region = getFirstConfiguredValue(awsEnvironment.AWS_REGION, awsEnvironment.AWS_DEFAULT_REGION);
  if (!region || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region) ||
      (awsEnvironment.AWS_REGION && awsEnvironment.AWS_DEFAULT_REGION &&
       awsEnvironment.AWS_REGION !== awsEnvironment.AWS_DEFAULT_REGION)) {
    throw new Error("AWS deployment region is missing, invalid, or inconsistent.");
  }
  if (!expectedAccountId || !/^\d{12}$/.test(expectedAccountId)) {
    throw new Error("AWS_EXPECTED_ACCOUNT_ID must be configured as a 12-digit AWS account ID.");
  }

  const output = executeAws(
    ["sts", "get-caller-identity", "--region", region, "--output", "json"],
    { env: awsEnvironment }
  );
  let identity;
  try {
    identity = JSON.parse(output);
  } catch {
    throw new Error("AWS caller identity response was not valid JSON.");
  }

  if (!identity.Account || !identity.Arn) {
    throw new Error("AWS caller identity response is missing Account or Arn.");
  }
  if (identity.Account !== expectedAccountId) {
    throw new Error("AWS caller identity does not match AWS_EXPECTED_ACCOUNT_ID.");
  }
  return identity;
}

function parseAwsJson(output, description) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${description} returned invalid JSON.`);
  }
}

function getStack(executeAws, stackName, awsEnvironment) {
  try {
    const response = parseAwsJson(
      executeAws(
        ["cloudformation", "describe-stacks", "--stack-name", stackName, "--output", "json"],
        { env: awsEnvironment }
      ),
      `CloudFormation stack ${stackName}`
    );
    return response.Stacks?.[0] || null;
  } catch (error) {
    if (/ValidationError.*does not exist|stack with id .* does not exist/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

function assertStackReady(stack) {
  if (!stack || !READY_STACK_STATUSES.has(stack.StackStatus)) {
    const status = stack?.StackStatus || "not found";
    throw new Error(`CloudFormation stack is not ready for deployment (status: ${status}).`);
  }
}

function getStackResources(executeAws, stackName, awsEnvironment) {
  const response = parseAwsJson(
    executeAws(
      ["cloudformation", "list-stack-resources", "--stack-name", stackName, "--output", "json"],
      { env: awsEnvironment }
    ),
    `CloudFormation resources for ${stackName}`
  );
  return response.StackResourceSummaries || [];
}

function assertManagedResource(resources, logicalResourceId, physicalResourceId, description) {
  const resource = resources.find(item => item.LogicalResourceId === logicalResourceId);
  if (!resource || resource.PhysicalResourceId !== physicalResourceId) {
    throw new Error(
      `${description} is not owned by the expected CloudFormation stack. ` +
      "Import it through a reviewed resource-import procedure or choose a new resource name."
    );
  }
}

function assertStackParameter(stack, parameterKey, expectedValue, stackName) {
  const parameter = stack?.Parameters?.find(item => item.ParameterKey === parameterKey);
  if (!parameter || parameter.ParameterValue !== String(expectedValue)) {
    throw new Error(
      `CloudFormation stack ${stackName} has a different or missing ${parameterKey}. ` +
      "Use a separate stack or perform a reviewed migration instead of repointing existing resources."
    );
  }
}

function buildCloudFormationParameters(config, packageKey) {
  return [
    ["EnvironmentName", config.environmentName],
    ["LambdaFunctionName", config.lambdaFunctionName],
    ["ArtifactBucketName", config.artifactBucketName],
    ["LambdaPackageKey", packageKey],
    ["VpcSubnetIds", config.vpcSubnetIds.join(",")],
    ["VpcSecurityGroupIds", config.vpcSecurityGroupIds.join(",")],
    ["DocumentBucketMode", config.documentBucketMode],
    ["DocumentBucketName", config.documentBucketName],
    ["DocumentBucketRegion", config.documentBucketRegion],
    ["CognitoRegion", config.cognitoRegion],
    ["CognitoUserPoolId", config.userPoolId],
    ["CognitoAppClientId", config.appClientId],
    ["CognitoClientSecret", config.cognitoClientSecret],
    ["DatabaseHost", config.databaseConfig.DB_HOST],
    ["DatabasePort", config.databaseConfig.DB_PORT],
    ["DatabaseUser", config.databaseConfig.DB_USER],
    ["DatabasePassword", config.databaseConfig.DB_PASSWORD],
    ["DatabaseName", config.databaseConfig.DB_NAME],
    ["SessionSecret", config.sessionSecret],
    ["TuApiUrl", config.tuApiUrl],
    ["TuApiKey", config.tuApiKey],
    ["AllowedOrigins", config.allowedOrigins.join(",")],
    ["LambdaRoleArn", config.lambdaRoleArn || ""]
  ].map(([ParameterKey, ParameterValue]) => ({
    ParameterKey,
    ParameterValue: String(ParameterValue)
  }));
}

function awsFileUri(filePath) {
  return `file://${path.resolve(filePath)}`;
}

function withParametersFile(parameters, callback) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "docuflow-cfn-"));
  const parametersPath = path.join(temporaryDirectory, "parameters.json");
  try {
    fs.writeFileSync(parametersPath, JSON.stringify(parameters), { mode: 0o600 });
    return callback(awsFileUri(parametersPath));
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function applyStack({
  executeAws,
  stackName,
  templatePath,
  parameters,
  awsEnvironment,
  existingStack
}) {
  const action = existingStack ? "update-stack" : "create-stack";
  const args = [
    "cloudformation",
    action,
    "--stack-name",
    stackName,
    "--template-body",
    awsFileUri(templatePath),
    "--parameters",
    null,
    "--capabilities",
    "CAPABILITY_NAMED_IAM",
    "--tags",
    "Key=Application,Value=DocuFlow",
    `Key=Environment,Value=${parameters.find(parameter => parameter.ParameterKey === "EnvironmentName")?.ParameterValue || "shared"}`
  ];
  if (!existingStack) {
    args.push("--on-failure", "DO_NOTHING");
  }

  return withParametersFile(parameters, parameterFileUri => {
    args[args.indexOf(null)] = parameterFileUri;
    try {
      executeAws(args, { env: awsEnvironment });
    } catch (error) {
      if (existingStack && /No updates are to be performed/i.test(error.message)) {
        return;
      }
      throw error;
    }

    const waiter = existingStack ? "stack-update-complete" : "stack-create-complete";
    executeAws(
      ["cloudformation", "wait", waiter, "--stack-name", stackName],
      { env: awsEnvironment }
    );
  });
}

function packageBackend() {
  const { zipPath: packagePath, digest } = createPackage();
  if (!fs.existsSync(packagePath) || fs.statSync(packagePath).size === 0) {
    throw new Error("Backend packaging did not produce backend/backend-full.zip.");
  }
  return { packagePath, digest };
}

function getPackageKey(digest, environmentName) {
  return `lambda/${environmentName}/${digest}.zip`;
}

function uploadPackage(executeAws, packagePath, bucketName, packageKey, digest, awsEnvironment) {
  try {
    const storedDigest = executeAws(
      [
        "s3api",
        "head-object",
        "--bucket",
        bucketName,
        "--key",
        packageKey,
        "--query",
        "Metadata.sha256",
        "--output",
        "text"
      ],
      { env: awsEnvironment }
    );
    if (storedDigest.trim() === digest) {
      return false;
    }
  } catch (error) {
    if (!/404|NoSuchKey|NotFound/i.test(error.message)) {
      throw error;
    }
  }

  executeAws(
    [
      "s3",
      "cp",
      packagePath,
      `s3://${bucketName}/${packageKey}`,
      "--region",
      awsEnvironment.AWS_REGION,
      "--sse",
      "AES256",
      "--metadata",
      `sha256=${digest}`
    ],
    { env: awsEnvironment }
  );
  return true;
}

function assertHealthResponse(response, healthData) {
  if (!response.ok || healthData?.ok !== true || healthData?.database !== "connected") {
    throw new Error(`Deployment health check failed (HTTP ${response.status}).`);
  }
}

function getStackOutputs(stack) {
  return Object.fromEntries((stack?.Outputs || []).map(output => [output.OutputKey, output.OutputValue]));
}

async function main() {
  const config = getRequiredDeploymentConfig(loadDeploymentConfig());
  const awsEnvironment = createAwsEnvironment({ AWS_REGION: config.region });

  console.log("DocuFlow V5 CloudFormation deployment");
  console.log(`[1/7] Verifying AWS account and region (${config.region})...`);
  const identity = verifyAwsIdentity(runAws, awsEnvironment, config.expectedAccountId);
  console.log(` -> Account: ${identity.Account}`);
  console.log(` -> IAM Arn: ${identity.Arn}`);

  console.log("[2/7] Checking CloudFormation stacks...");
  const artifactStack = getStack(runAws, config.artifactStackName, awsEnvironment);
  if (artifactStack) {
    assertStackReady(artifactStack);
    assertStackParameter(artifactStack, "EnvironmentName", config.environmentName, config.artifactStackName);
    assertStackParameter(
      artifactStack,
      "ArtifactBucketName",
      config.artifactBucketName,
      config.artifactStackName
    );
    assertManagedResource(
      getStackResources(runAws, config.artifactStackName, awsEnvironment),
      "ArtifactBucket",
      config.artifactBucketName,
      "Deployment artifact bucket"
    );
  }

  const appStack = getStack(runAws, config.stackName, awsEnvironment);
  if (appStack) {
    assertStackReady(appStack);
    for (const [parameterKey, expectedValue] of [
      ["EnvironmentName", config.environmentName],
      ["LambdaFunctionName", config.lambdaFunctionName],
      ["DocumentBucketName", config.documentBucketName],
      ["DocumentBucketMode", config.documentBucketMode],
      ["CognitoRegion", config.cognitoRegion],
      ["CognitoUserPoolId", config.userPoolId],
      ["CognitoAppClientId", config.appClientId]
    ]) {
      assertStackParameter(appStack, parameterKey, expectedValue, config.stackName);
    }
    assertManagedResource(
      getStackResources(runAws, config.stackName, awsEnvironment),
      "ApiFunction",
      config.lambdaFunctionName,
      "Lambda function"
    );
  } else {
    try {
      runAws(
        ["lambda", "get-function-configuration", "--function-name", config.lambdaFunctionName],
        { env: awsEnvironment }
      );
      throw new Error(
        `Lambda function ${config.lambdaFunctionName} already exists outside stack ${config.stackName}. ` +
        "Import it through a reviewed resource-import procedure or choose a new function name."
      );
    } catch (error) {
      if (!/ResourceNotFoundException|Function not found|does not exist/i.test(error.message)) {
        throw error;
      }
    }
  }

  console.log("[3/7] Packaging backend...");
  const { packagePath, digest } = packageBackend();
  const packageKey = getPackageKey(digest, config.environmentName);

  console.log("[4/7] Provisioning the private deployment-artifact bucket stack...");
  const artifactParameters = [
    { ParameterKey: "EnvironmentName", ParameterValue: config.environmentName },
    { ParameterKey: "ArtifactBucketName", ParameterValue: config.artifactBucketName }
  ];
  applyStack({
    executeAws: runAws,
    stackName: config.artifactStackName,
    templatePath: path.join(CLOUDFORMATION_ROOT, "artifact-bucket.json"),
    parameters: artifactParameters,
    awsEnvironment,
    existingStack: artifactStack
  });

  console.log("[5/7] Uploading the versioned Lambda package...");
  const uploaded = uploadPackage(
    runAws,
    packagePath,
    config.artifactBucketName,
    packageKey,
    digest,
    awsEnvironment
  );
  console.log(uploaded ? " -> Package uploaded." : " -> Identical package already exists; upload skipped.");

  console.log("[6/7] Creating or updating the backend CloudFormation stack...");
  applyStack({
    executeAws: runAws,
    stackName: config.stackName,
    templatePath: path.join(CLOUDFORMATION_ROOT, "docuflow.json"),
    parameters: buildCloudFormationParameters(config, packageKey),
    awsEnvironment,
    existingStack: appStack
  });

  console.log("[7/7] Waiting for Lambda and checking the health endpoint...");
  runAws(
    ["lambda", "wait", "function-active-v2", "--function-name", config.lambdaFunctionName],
    { env: awsEnvironment }
  );
  const functionConfiguration = parseAwsJson(
    runAws(
      [
        "lambda",
        "get-function-configuration",
        "--function-name",
        config.lambdaFunctionName,
        "--query",
        "{State:State,LastUpdateStatus:LastUpdateStatus}",
        "--output",
        "json"
      ],
      { env: awsEnvironment }
    ),
    "Lambda function configuration"
  );
  if (functionConfiguration.State !== "Active" ||
      functionConfiguration.LastUpdateStatus !== "Successful") {
    throw new Error(
      `Lambda is not ready (state: ${functionConfiguration.State}, ` +
      `last update: ${functionConfiguration.LastUpdateStatus}).`
    );
  }

  const deployedStack = getStack(runAws, config.stackName, awsEnvironment);
  const outputs = getStackOutputs(deployedStack);
  const functionUrl = outputs.FunctionUrl?.replace(/\/+$/, "");
  if (!functionUrl || !outputs.LambdaArn || !outputs.DocumentBucketName) {
    throw new Error("CloudFormation deployment is missing one or more required outputs.");
  }

  const healthResponse = await fetch(`${functionUrl}/api/health`, {
    signal: AbortSignal.timeout(15000)
  });
  let healthData;
  try {
    healthData = await healthResponse.json();
  } catch {
    throw new Error(`Deployment health endpoint returned invalid JSON (HTTP ${healthResponse.status}).`);
  }
  assertHealthResponse(healthResponse, healthData);

  console.log("\nDeployment summary");
  console.log(` Environment:       ${config.environmentName}`);
  console.log(` CloudFormation:    ${config.stackName}`);
  console.log(` Lambda ARN:        ${outputs.LambdaArn}`);
  console.log(` Lambda Function URL: ${functionUrl}`);
  console.log(` Document bucket:   ${outputs.DocumentBucketName}`);
  console.log(` Package SHA-256:   ${digest}`);
  console.log(` Health:            HTTP ${healthResponse.status} (database connected)`);
  console.log(" Cognito trigger:   permission provisioned; existing User Pool association requires reviewed setup");
}

if (require.main === module) {
  main().catch(error => {
    console.error("\nDeployment failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertHealthResponse,
  applyStack,
  assertManagedResource,
  assertStackParameter,
  assertStackReady,
  buildCloudFormationParameters,
  createAwsEnvironment,
  getRequiredDatabaseConfig,
  getRequiredDeploymentConfig,
  getRequiredSessionSecret,
  getStack,
  getStackOutputs,
  loadDeploymentConfig,
  parseAllowedOrigins,
  uploadPackage,
  verifyAwsIdentity
};
