const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PutObjectCommand, DeleteObjectCommand } = require("../node_modules/@aws-sdk/client-s3");
const {
    getVerificationConfig,
    verifyCallerAccount,
    testServices
} = require("../../scripts/verify-services");

const validTarget = {
    DEPLOY_ENVIRONMENT: "dev",
    AWS_REGION: "us-east-1",
    AWS_EXPECTED_ACCOUNT_ID: "123456789012",
    V5_VERIFY_S3_BUCKET: "docuflow-v5-test-bucket",
    V5_VERIFY_FUNCTION_URL: "https://abc123.lambda-url.us-east-1.on.aws"
};

test("service verification requires explicit environment-scoped V5 targets", () => {
    const config = getVerificationConfig(validTarget);
    assert.equal(config.environmentName, "dev");
    assert.equal(config.bucketName, validTarget.V5_VERIFY_S3_BUCKET);
    assert.equal(config.functionUrl, validTarget.V5_VERIFY_FUNCTION_URL);

    assert.throws(() => getVerificationConfig({}), /DEPLOY_ENVIRONMENT/);
    assert.throws(() => getVerificationConfig({ ...validTarget, V5_VERIFY_S3_BUCKET: undefined }), /V5_VERIFY_S3_BUCKET/);
});

test("service verification rejects V2 resources and cross-region Function URLs", () => {
    assert.throws(
        () => getVerificationConfig({ ...validTarget, V5_VERIFY_S3_BUCKET: "cs361-v2-docuflow-123456789012" }),
        /protected V2 S3 bucket/
    );
    assert.throws(
        () => getVerificationConfig({
            ...validTarget,
            V5_VERIFY_FUNCTION_URL: "https://htvtloifbzeywxdh4gawlqoxdq0tftsv.lambda-url.us-east-1.on.aws"
        }),
        /protected V2 Lambda/
    );
    assert.throws(
        () => getVerificationConfig({
            ...validTarget,
            V5_VERIFY_FUNCTION_URL: "https://htvtloifbzeywxdh4gawlqoxdq0tftsv.lambda-url.eu-west-1.on.aws",
            AWS_REGION: "eu-west-1"
        }),
        /protected V2 Lambda/
    );
    assert.throws(
        () => getVerificationConfig({
            ...validTarget,
            AWS_REGION: "us-west-2"
        }),
        /matching AWS_REGION/
    );
});

test("service verification deletes its S3 object after read-back failure", async () => {
    const config = getVerificationConfig(validTarget);
    const commands = [];
    await assert.rejects(testServices(config, {
        verifyCallerAccount: () => {},
        createS3Client: () => ({ send: async command => { commands.push(command); } }),
        getSignedUrl: async () => "https://signed.example/object",
        fetch: async () => ({ ok: false, text: async () => "" })
    }), /S3 read-back verification failed/);
    assert.equal(commands.length, 2);
    assert.ok(commands[0] instanceof PutObjectCommand);
    assert.ok(commands[1] instanceof DeleteObjectCommand);
    assert.equal(commands[0].input.Bucket, config.bucketName);
    assert.equal(commands[1].input.Key, commands[0].input.Key);
});

test("account mismatch prevents all S3 writes", async () => {
    let clientCreated = false;
    await assert.rejects(testServices(getVerificationConfig(validTarget), {
        verifyCallerAccount: () => { throw new Error("account mismatch"); },
        createS3Client: () => { clientCreated = true; throw new Error("unexpected S3 client"); }
    }), /account mismatch/);
    assert.equal(clientCreated, false);
});

test("RDS tunnel validates AWS account before resource calls and uses AWS CLI credential chain", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/connect-rds-tunnel.ps1"), "utf8");
    const accountCheck = source.indexOf("aws sts get-caller-identity");
    const rdsCall = source.indexOf("aws rds describe-db-instances");
    const bastionCall = source.indexOf("aws ec2 describe-instances");
    const sessionCall = source.indexOf("aws ssm start-session");
    assert.ok(accountCheck >= 0 && accountCheck < rdsCall && rdsCall < bastionCall && bastionCall < sessionCall);
    assert.match(source, /AWS CLI uses its normal credential provider chain/i);
    assert.doesNotMatch(source, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|\.env|Set-AWSCredential/i);
    assert.match(source, /callerAccount\.Trim\(\) -ne \$ExpectedAccountId/);
});

test("deploy workflow maps required VPC repository variables into job environment", () => {
    const workflow = fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/deploy.yml"), "utf8");
    assert.match(workflow, /^      VPC_SUBNET_IDS: \$\{\{ vars\.VPC_SUBNET_IDS \}\}$/m);
    assert.match(workflow, /^      VPC_SECURITY_GROUP_IDS: \$\{\{ vars\.VPC_SECURITY_GROUP_IDS \}\}$/m);
});

test("service verification requires the configured AWS caller account", () => {
    const config = getVerificationConfig(validTarget);
    let receivedArgs;
    verifyCallerAccount(config, args => {
        receivedArgs = args;
        return "123456789012\n";
    });
    assert.deepEqual(receivedArgs, [
        "sts", "get-caller-identity",
        "--region", "us-east-1",
        "--query", "Account",
        "--output", "text"
    ]);
    assert.throws(
        () => verifyCallerAccount(config, () => "000000000000"),
        /does not match/
    );
    assert.throws(
        () => verifyCallerAccount(config, () => { throw new Error("AWS unavailable"); }),
        /Unable to verify AWS caller account/
    );
});

test("legacy permission workaround is inert", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../scripts/fix-permission.js"), "utf8");
    assert.match(source, /intentionally performs no AWS calls/i);
    assert.doesNotMatch(source, /add-permission|execSync|child_process/);
});
