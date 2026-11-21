const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { hashDirectory } = require("../package-zip");
const { getConfiguredBucketName } = require("../s3");
const {
    assertHealthResponse,
    assertManagedResource,
    assertStackReady,
    assertStackParameter,
    applyStack,
    buildCloudFormationParameters,
    createAwsEnvironment,
    getRequiredDatabaseConfig,
    getRequiredDeploymentConfig,
    getRequiredSessionSecret,
    getStack,
    loadDeploymentConfig,
    parseAllowedOrigins,
    uploadPackage,
    verifyAwsIdentity
} = require("../../scripts/deploy-aws");

const validConfig = {
    AWS_REGION: "us-east-1",
    AWS_EXPECTED_ACCOUNT_ID: "123456789012",
    DEPLOY_ENVIRONMENT: "dev",
    ARTIFACT_BUCKET_NAME: "docuflow-test-artifacts",
    DOCUMENT_BUCKET_NAME: "docuflow-test-documents",
    DOCUMENT_BUCKET_MODE: "Existing",
    COGNITO_USER_POOL_ID: "us-east-1_testPool",
    COGNITO_APP_CLIENT_ID: "test-client",
    FRONTEND_ALLOWED_ORIGINS: "https://docuflow.example.invalid",
    DB_HOST: "docuflow-test.abc123.us-east-1.rds.amazonaws.com",
    DB_PORT: "3306",
    DB_USER: "unit-test-user",
    DB_PASSWORD: "unit-test-password",
    DB_NAME: "unit_test",
    SESSION_SECRET: "unit-test-session-secret",
    VPC_SUBNET_IDS: "subnet-0123456789abcdef0,subnet-0abcdef0123456789",
    VPC_SECURITY_GROUP_IDS: "sg-0123456789abcdef0"
};

const validDeploymentConfig = getRequiredDeploymentConfig(validConfig);

test("S3 bucket configuration has no implicit bucket fallback", () => {
    assert.equal(
        getConfiguredBucketName({ S3_BUCKET: "configured-bucket" }),
        "configured-bucket"
    );
    assert.equal(
        getConfiguredBucketName({ AWS_S3_BUCKET: "legacy-configured-bucket" }),
        "legacy-configured-bucket"
    );
    assert.throws(
        () => getConfiguredBucketName({}),
        /S3 bucket configuration is missing/
    );
});

test("deployment configuration requires explicit RDS MySQL connection and session settings", async t => {
    await t.test("accepts a complete configuration and preserves backend aliases", () => {
        assert.deepEqual(getRequiredDatabaseConfig(validConfig), {
            DB_HOST: validConfig.DB_HOST,
            DB_PORT: validConfig.DB_PORT,
            DB_USER: validConfig.DB_USER,
            DB_PASSWORD: validConfig.DB_PASSWORD,
            DB_NAME: validConfig.DB_NAME,
            DB_USERNAME: validConfig.DB_USER,
            DB_DATABASE: validConfig.DB_NAME
        });
    });

    await t.test("supports existing DB_USERNAME and DB_DATABASE aliases", () => {
        const { DB_USER, DB_NAME, ...config } = validConfig;
        const result = getRequiredDatabaseConfig({
            ...config,
            DB_USERNAME: validConfig.DB_USER,
            DB_DATABASE: validConfig.DB_NAME
        });

        assert.equal(result.DB_USER, validConfig.DB_USER);
        assert.equal(result.DB_USERNAME, validConfig.DB_USER);
        assert.equal(result.DB_NAME, validConfig.DB_NAME);
        assert.equal(result.DB_DATABASE, validConfig.DB_NAME);
    });

    for (const [description, password] of [
        ["missing", undefined],
        ["empty", ""],
        ["whitespace-only", "   "]
    ]) {
        await t.test(`rejects a ${description} DB_PASSWORD without revealing values`, () => {
            assert.throws(
                () => getRequiredDatabaseConfig({ ...validConfig, DB_PASSWORD: password }),
                error => {
                    assert.match(error.message, /DB_PASSWORD/);
                    assert.equal(error.message.includes(validConfig.DB_PASSWORD), false);
                    return true;
                }
            );
        });
    }

    await t.test("rejects missing database settings", () => {
        const config = { ...validConfig };
        delete config.DB_HOST;
        delete config.DB_USER;
        delete config.DB_PORT;
        delete config.DB_NAME;

        assert.throws(
            () => getRequiredDatabaseConfig(config),
            error => {
                assert.match(error.message, /DB_HOST/);
                assert.match(error.message, /DB_USER/);
                assert.match(error.message, /DB_PORT/);
                assert.match(error.message, /DB_NAME/);
                assert.equal(error.message.includes(validConfig.DB_PASSWORD), false);
                return true;
            }
        );
    });

    await t.test("rejects invalid database ports", () => {
        assert.throws(
            () => getRequiredDatabaseConfig({ ...validConfig, DB_PORT: "70000" }),
            /DB_PORT must be an integer/
        );
    });

    await t.test("requires a non-empty session secret without exposing it", () => {
        assert.throws(
            () => getRequiredSessionSecret({ SESSION_SECRET: " " }),
            error => {
                assert.match(error.message, /SESSION_SECRET/);
                assert.equal(error.message.includes(validConfig.SESSION_SECRET), false);
                return true;
            }
        );
    });
});

test("deployment configuration validates environment-specific resources and origins", async t => {
    await t.test("builds dev configuration from terminal-compatible variables", () => {
        const config = getRequiredDeploymentConfig(validConfig);
        assert.equal(config.environmentName, "dev");
        assert.equal(config.stackName, "docuflow-dev");
        assert.equal(config.lambdaFunctionName, "docuflow-dev-api");
        assert.equal(config.artifactStackName, "docuflow-dev-artifacts");
        assert.equal(config.cognitoRegion, "us-east-1");
        assert.equal(config.documentBucketMode, "Existing");
        assert.deepEqual(config.allowedOrigins, ["https://docuflow.example.invalid"]);
    });

    await t.test("supports separate production stack and resource names", () => {
        const config = getRequiredDeploymentConfig({
            ...validConfig,
            DEPLOY_ENVIRONMENT: "production",
            CLOUDFORMATION_STACK_NAME: "docuflow-live",
            LAMBDA_FUNCTION_NAME: "docuflow-live-api",
            DOCUMENT_BUCKET_MODE: "Create",
            AWS_S3_REGION: "us-west-2",
            COGNITO_REGION: "us-west-2"
        });
        assert.equal(config.stackName, "docuflow-live");
        assert.equal(config.lambdaFunctionName, "docuflow-live-api");
        assert.equal(config.documentBucketMode, "Create");
        assert.equal(config.documentBucketRegion, "us-west-2");
    });

    await t.test("requires CloudFormation, Cognito, S3 and frontend configuration", () => {
        for (const name of [
            "AWS_REGION",
            "AWS_EXPECTED_ACCOUNT_ID",
            "ARTIFACT_BUCKET_NAME",
            "DOCUMENT_BUCKET_NAME",
            "COGNITO_USER_POOL_ID",
            "COGNITO_APP_CLIENT_ID",
            "FRONTEND_ALLOWED_ORIGINS"
        ]) {
            const config = { ...validConfig };
            delete config[name];
            assert.throws(() => getRequiredDeploymentConfig(config), new RegExp(name));
        }
    });

    await t.test("requires an expected account ID and valid target region", () => {
        assert.throws(
            () => getRequiredDeploymentConfig({
                ...validConfig,
                AWS_EXPECTED_ACCOUNT_ID: undefined
            }),
            /AWS_EXPECTED_ACCOUNT_ID/
        );
        assert.throws(
            () => getRequiredDeploymentConfig({ ...validConfig, AWS_REGION: "not-a-region" }),
            /AWS_REGION/
        );
    });

    await t.test("refuses to target the protected V2 Lambda", () => {
        assert.throws(
            () => getRequiredDeploymentConfig({
                ...validConfig,
                LAMBDA_FUNCTION_NAME: "cs361-v2-documentflow-api"
            }),
            /cannot target the protected V2 Lambda/
        );
    });

    await t.test("rejects malformed or duplicate VPC resource IDs", () => {
        assert.throws(
            () => getRequiredDeploymentConfig({
                ...validConfig,
                VPC_SUBNET_IDS: `subnet-invalid,${validConfig.VPC_SUBNET_IDS.split(",")[1]}`
            }),
            /VPC_SUBNET_IDS/
        );
        assert.throws(
            () => getRequiredDeploymentConfig({
                ...validConfig,
                VPC_SUBNET_IDS: `${validConfig.VPC_SUBNET_IDS.split(",")[0]},${validConfig.VPC_SUBNET_IDS.split(",")[0]}`
            }),
            /VPC_SUBNET_IDS/
        );
    });

    await t.test("requires explicit VPC resources for each target environment", () => {
        const withoutSubnets = { ...validConfig };
        delete withoutSubnets.VPC_SUBNET_IDS;
        assert.throws(() => getRequiredDeploymentConfig(withoutSubnets), /VPC_SUBNET_IDS/);

        const withoutSecurityGroups = { ...validConfig };
        delete withoutSecurityGroups.VPC_SECURITY_GROUP_IDS;
        assert.throws(() => getRequiredDeploymentConfig(withoutSecurityGroups), /VPC_SECURITY_GROUP_IDS/);
    });

    await t.test("rejects unsupported environment and invalid CORS origins", () => {
        assert.throws(
            () => getRequiredDeploymentConfig({ ...validConfig, DEPLOY_ENVIRONMENT: "prod" }),
            /DEPLOY_ENVIRONMENT/
        );
        assert.throws(() => parseAllowedOrigins("*"), /valid HTTPS origins/);
        assert.throws(
            () => parseAllowedOrigins("http://public.example.invalid"),
            /valid HTTPS origins/
        );
        assert.deepEqual(
            parseAllowedOrigins("https://a.example.invalid, https://a.example.invalid"),
            ["https://a.example.invalid"]
        );
    });

    await t.test("terminal environment overrides backend .env values", () => {
        const config = loadDeploymentConfig({ AWS_REGION: "eu-west-1" });
        assert.equal(config.AWS_REGION, "eu-west-1");
    });
});

test("AWS credential and identity validation supports temporary session credentials", () => {
    const temporaryCredentials = {
        AWS_ACCESS_KEY_ID: "academy-access-key",
        AWS_SECRET_ACCESS_KEY: "academy-secret-key",
        AWS_SESSION_TOKEN: "academy-session-token",
        AWS_PROFILE: "academy"
    };
    const awsEnvironment = createAwsEnvironment(
        { AWS_REGION: "us-east-1" },
        temporaryCredentials
    );
    assert.equal(awsEnvironment.AWS_SESSION_TOKEN, temporaryCredentials.AWS_SESSION_TOKEN);
    assert.equal(awsEnvironment.AWS_ACCESS_KEY_ID, temporaryCredentials.AWS_ACCESS_KEY_ID);
    assert.equal(awsEnvironment.AWS_SECRET_ACCESS_KEY, temporaryCredentials.AWS_SECRET_ACCESS_KEY);
    assert.equal(awsEnvironment.AWS_PROFILE, temporaryCredentials.AWS_PROFILE);
    assert.equal(awsEnvironment.AWS_REGION, "us-east-1");
    assert.equal(awsEnvironment.AWS_DEFAULT_REGION, "us-east-1");

    let receivedArgs;
    const identity = verifyAwsIdentity((args, options) => {
        receivedArgs = args;
        assert.equal(options.env, awsEnvironment);
        return JSON.stringify({
            Account: "123456789012",
            Arn: "arn:aws:sts::123456789012:assumed-role/academy/session"
        });
    }, awsEnvironment, "123456789012");

    assert.deepEqual(receivedArgs, [
        "sts",
        "get-caller-identity",
        "--region",
        "us-east-1",
        "--output",
        "json"
    ]);
    assert.equal(identity.Account, "123456789012");
    assert.throws(
        () => verifyAwsIdentity(
            () => JSON.stringify({ Account: "000000000000", Arn: "arn:aws:iam::000000000000:user/test" }),
            awsEnvironment,
            "123456789012"
        ),
        /does not match/
    );
    assert.throws(
        () => verifyAwsIdentity(() => "", {}, "123456789012"),
        /region is missing, invalid, or inconsistent/
    );
    assert.throws(
        () => verifyAwsIdentity(() => "", awsEnvironment, ""),
        /AWS_EXPECTED_ACCOUNT_ID/
    );
});

test("CloudFormation parameter mapping and stack preflight are explicit and fail closed", () => {
    const parameters = buildCloudFormationParameters(validDeploymentConfig, "lambda/dev/abc123.zip");
    const values = Object.fromEntries(parameters.map(({ ParameterKey, ParameterValue }) => [
        ParameterKey,
        ParameterValue
    ]));

    assert.equal(values.EnvironmentName, "dev");
    assert.equal(values.LambdaFunctionName, "docuflow-dev-api");
    assert.equal(values.LambdaPackageKey, "lambda/dev/abc123.zip");
    assert.equal(
        values.VpcSubnetIds,
        validConfig.VPC_SUBNET_IDS
    );
    assert.equal(values.VpcSecurityGroupIds, validConfig.VPC_SECURITY_GROUP_IDS);
    assert.equal(values.DocumentBucketName, validConfig.DOCUMENT_BUCKET_NAME);
    assert.equal(values.CognitoUserPoolId, validConfig.COGNITO_USER_POOL_ID);
    assert.equal(values.DatabasePassword, validConfig.DB_PASSWORD);
    assert.equal(values.SessionSecret, validConfig.SESSION_SECRET);
    assert.equal(values.AllowedOrigins, "https://docuflow.example.invalid");
    assert.throws(
        () => assertStackReady({ StackStatus: "UPDATE_IN_PROGRESS" }),
        /not ready/
    );
    assert.doesNotThrow(() => assertStackReady({ StackStatus: "UPDATE_ROLLBACK_COMPLETE" }));
    assert.doesNotThrow(() => assertStackReady({ StackStatus: "IMPORT_COMPLETE" }));
    assert.throws(
        () => assertManagedResource(
            [{ LogicalResourceId: "ApiFunction", PhysicalResourceId: "other-api" }],
            "ApiFunction",
            "docuflow-dev-api",
            "Lambda function"
        ),
        /not owned by the expected CloudFormation stack/
    );
    assert.throws(
        () => assertStackParameter(
            { Parameters: [{ ParameterKey: "EnvironmentName", ParameterValue: "production" }] },
            "EnvironmentName",
            "dev",
            "docuflow-dev"
        ),
        /different or missing EnvironmentName/
    );
    assert.throws(
        () => assertStackParameter(
            {
                Parameters: [{
                    ParameterKey: "LambdaFunctionName",
                    ParameterValue: "cs361-v2-documentflow-api"
                }]
            },
            "LambdaFunctionName",
            "docuflow-dev-api",
            "docuflow-dev"
        ),
        /different or missing LambdaFunctionName/
    );
    assert.throws(
        () => assertManagedResource(
            [{
                LogicalResourceId: "ApiFunction",
                PhysicalResourceId: "cs361-v2-documentflow-api"
            }],
            "ApiFunction",
            "docuflow-dev-api",
            "Lambda function"
        ),
        /not owned by the expected CloudFormation stack/
    );
});

test("existing CloudFormation stacks are updated rather than recreated", () => {
    const calls = [];
    let parameterFilePath;
    applyStack({
        executeAws(args) {
            calls.push(args);
            if (args[1] === "update-stack") {
                parameterFilePath = args[args.indexOf("--parameters") + 1].slice("file://".length);
                assert.equal(
                    JSON.parse(fs.readFileSync(parameterFilePath, "utf8"))[0].ParameterValue,
                    "dev"
                );
            }
            return "";
        },
        stackName: "docuflow-test",
        templatePath: path.resolve(__dirname, "../../infra/cloudformation/docuflow.json"),
        parameters: [{ ParameterKey: "EnvironmentName", ParameterValue: "dev" }],
        awsEnvironment: {},
        existingStack: { StackStatus: "UPDATE_COMPLETE" }
    });

    assert.equal(calls[0][1], "update-stack");
    assert.deepEqual(calls[1].slice(0, 3), [
        "cloudformation",
        "wait",
        "stack-update-complete"
    ]);
    assert.equal(fs.existsSync(parameterFilePath), false);
});

test("a missing CloudFormation stack is created, while AccessDenied propagates", () => {
    const stackName = "docuflow-test";
    const missingStack = getStack(() => {
        throw new Error(
            "AWS CLI cloudformation describe-stacks failed: " +
            "An error occurred (ValidationError): Stack with id docuflow-test does not exist"
        );
    }, stackName, {});
    assert.equal(missingStack, null);

    assert.throws(
        () => getStack(() => {
            throw new Error("AWS CLI cloudformation describe-stacks failed: AccessDenied");
        }, stackName, {}),
        /AccessDenied/
    );

    const calls = [];
    applyStack({
        executeAws(args) {
            calls.push(args);
            return "";
        },
        stackName,
        templatePath: path.resolve(__dirname, "../../infra/cloudformation/docuflow.json"),
        parameters: [{ ParameterKey: "EnvironmentName", ParameterValue: "dev" }],
        awsEnvironment: {},
        existingStack: missingStack
    });
    assert.equal(calls[0][1], "create-stack");
    assert.ok(calls[0].includes("DO_NOTHING"));
    assert.deepEqual(calls[1].slice(0, 3), [
        "cloudformation",
        "wait",
        "stack-create-complete"
    ]);
});

test("VPC parameters are included in CloudFormation request parameters", () => {
    const parameters = buildCloudFormationParameters(
        validDeploymentConfig,
        "lambda/dev/abc123.zip"
    );
    let cloudFormationParameters;

    applyStack({
        executeAws(args) {
            if (args[1] === "create-stack") {
                const parametersFile = args[args.indexOf("--parameters") + 1]
                    .slice("file://".length);
                cloudFormationParameters = JSON.parse(fs.readFileSync(parametersFile, "utf8"));
            }
            return "";
        },
        stackName: "docuflow-test",
        templatePath: path.resolve(__dirname, "../../infra/cloudformation/docuflow.json"),
        parameters,
        awsEnvironment: {},
        existingStack: null
    });

    const values = Object.fromEntries(cloudFormationParameters.map(({
        ParameterKey,
        ParameterValue
    }) => [ParameterKey, ParameterValue]));
    assert.equal(
        values.VpcSubnetIds,
        validConfig.VPC_SUBNET_IDS
    );
    assert.equal(values.VpcSecurityGroupIds, validConfig.VPC_SECURITY_GROUP_IDS);
});

test("CloudFormation failures propagate and temporary parameter files are cleaned up", () => {
    let parameterFilePath;
    let calls = 0;
    assert.throws(() => applyStack({
        executeAws(args) {
            calls += 1;
            parameterFilePath = args[args.indexOf("--parameters") + 1].slice("file://".length);
            throw new Error("CloudFormation access denied");
        },
        stackName: "docuflow-test",
        templatePath: path.resolve(__dirname, "../../infra/cloudformation/docuflow.json"),
        parameters: [
            { ParameterKey: "EnvironmentName", ParameterValue: "dev" },
            { ParameterKey: "SessionSecret", ParameterValue: "unit-test-secret" }
        ],
        awsEnvironment: {},
        existingStack: null
    }), /CloudFormation access denied/);
    assert.equal(calls, 1);
    assert.ok(parameterFilePath);
    assert.equal(fs.existsSync(parameterFilePath), false);
});

test("package fingerprints are content-based and unchanged packages are not uploaded twice", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "docuflow-package-test-"));
    try {
        fs.mkdirSync(path.join(temporaryDirectory, "nested"));
        fs.writeFileSync(path.join(temporaryDirectory, "nested", "module.js"), "module.exports = 1;");
        const firstDigest = hashDirectory(temporaryDirectory);
        fs.utimesSync(path.join(temporaryDirectory, "nested", "module.js"), new Date(), new Date());
        assert.equal(hashDirectory(temporaryDirectory), firstDigest);

        fs.writeFileSync(path.join(temporaryDirectory, "nested", "module.js"), "module.exports = 2;");
        assert.notEqual(hashDirectory(temporaryDirectory), firstDigest);

        fs.mkdirSync(path.join(temporaryDirectory, "node_modules"));
        fs.writeFileSync(path.join(temporaryDirectory, "node_modules", "installed.js"), "version one");
        const sourceDigest = hashDirectory(temporaryDirectory, new Set(["node_modules"]));
        fs.writeFileSync(path.join(temporaryDirectory, "node_modules", "installed.js"), "version two");
        assert.equal(
            hashDirectory(temporaryDirectory, new Set(["node_modules"])),
            sourceDigest
        );
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    let existingObjectCalls = 0;
    assert.equal(uploadPackage(
        () => {
            existingObjectCalls += 1;
            return "same-digest";
        },
        "backend-full.zip",
        "docuflow-artifacts",
        "lambda/dev/same-digest.zip",
        "same-digest",
        { AWS_REGION: "us-east-1" }
    ), false);
    assert.equal(existingObjectCalls, 1);

    const uploadCalls = [];
    assert.equal(uploadPackage(
        args => {
            uploadCalls.push(args);
            if (args[0] === "s3api") {
                throw new Error("AWS CLI s3api head-object failed: 404 Not Found");
            }
            return "";
        },
        "backend-full.zip",
        "docuflow-artifacts",
        "lambda/dev/new-digest.zip",
        "new-digest",
        { AWS_REGION: "us-east-1" }
    ), true);
    assert.equal(uploadCalls.length, 2);
    assert.equal(uploadCalls[1][0], "s3");
    assert.ok(uploadCalls[1].includes("sha256=new-digest"));
    assert.throws(
        () => uploadPackage(
            () => {
                throw new Error("AWS CLI s3api head-object failed: AccessDenied");
            },
            "backend-full.zip",
            "docuflow-artifacts",
            "lambda/dev/new-digest.zip",
            "new-digest",
            { AWS_REGION: "us-east-1" }
        ),
        /AccessDenied/
    );
});

test("CloudFormation templates declare required protected and retained resources", () => {
    const cloudFormationRoot = path.resolve(__dirname, "../../infra/cloudformation");
    const applicationTemplate = JSON.parse(
        fs.readFileSync(path.join(cloudFormationRoot, "docuflow.json"), "utf8")
    );
    const artifactTemplate = JSON.parse(
        fs.readFileSync(path.join(cloudFormationRoot, "artifact-bucket.json"), "utf8")
    );
    const appResources = applicationTemplate.Resources;

    assert.ok(applicationTemplate.Parameters.CognitoUserPoolId);
    assert.ok(applicationTemplate.Parameters.CognitoAppClientId);
    assert.equal(applicationTemplate.Parameters.VpcSubnetIds.Type, "CommaDelimitedList");
    assert.equal(applicationTemplate.Parameters.VpcSecurityGroupIds.Type, "CommaDelimitedList");
    assert.equal(Object.hasOwn(applicationTemplate.Parameters.VpcSubnetIds, "Default"), false);
    assert.equal(Object.hasOwn(applicationTemplate.Parameters.VpcSecurityGroupIds, "Default"), false);
    assert.deepEqual(appResources.ApiFunction.Properties.VpcConfig, {
        SubnetIds: { Ref: "VpcSubnetIds" },
        SecurityGroupIds: { Ref: "VpcSecurityGroupIds" }
    });
    assert.equal(appResources.ApiFunction.Properties.Environment.Variables.DB_SSL, "true");
    const executionPolicy = appResources.LambdaExecutionRole.Properties.Policies[0]
        .PolicyDocument.Statement;
    const vpcPermissions = executionPolicy.find(statement =>
        statement.Sid === "LambdaVpcNetworkInterfaceAccess"
    );
    assert.deepEqual(vpcPermissions.Action, [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface",
        "ec2:AssignPrivateIpAddresses",
        "ec2:UnassignPrivateIpAddresses"
    ]);
    assert.equal(applicationTemplate.Parameters.DatabasePassword.NoEcho, true);
    assert.equal(applicationTemplate.Parameters.DatabaseHost.NoEcho, true);
    assert.equal(applicationTemplate.Parameters.DatabaseUser.NoEcho, true);
    assert.equal(applicationTemplate.Parameters.SessionSecret.NoEcho, true);
    assert.equal(applicationTemplate.Parameters.TuApiKey.NoEcho, true);
    assert.equal(appResources.ApiFunctionUrl.Properties.AuthType, "NONE");
    assert.equal(appResources.CognitoPostAuthenticationPermission.Properties.Principal, "cognito-idp.amazonaws.com");
    assert.equal(
        appResources.PublicFunctionUrlInvokePermission.Properties.InvokedViaFunctionUrl,
        true
    );
    assert.equal(appResources.DocumentBucket.DeletionPolicy, "Retain");
    assert.equal(appResources.DocumentBucket.UpdateReplacePolicy, "Retain");
    assert.equal(
        appResources.DocumentBucket.Properties.PublicAccessBlockConfiguration.BlockPublicPolicy,
        true
    );
    assert.equal(artifactTemplate.Resources.ArtifactBucket.DeletionPolicy, "Retain");
    assert.equal(
        artifactTemplate.Resources.ArtifactBucket.Properties.PublicAccessBlockConfiguration.RestrictPublicBuckets,
        true
    );
    assert.ok(applicationTemplate.Outputs.LambdaArn);
    assert.ok(applicationTemplate.Outputs.FunctionUrl);
    assert.ok(applicationTemplate.Outputs.DocumentBucketName);
    assert.equal(
        Object.values(appResources).some(resource =>
            resource.Type === "AWS::ApiGateway::RestApi" ||
            resource.Type === "AWS::RDS::DBInstance"
        ),
        false
    );
});

test("deployment health validation treats unhealthy responses as failures", () => {
    assert.doesNotThrow(() => assertHealthResponse(
        { ok: true, status: 200 },
        { ok: true, database: "connected" }
    ));
    assert.throws(
        () => assertHealthResponse({ ok: false, status: 503 }, { ok: false }),
        /health check failed \(HTTP 503\)/
    );
    assert.throws(
        () => assertHealthResponse({ ok: true, status: 200 }, { ok: true, database: "disconnected" }),
        /health check failed \(HTTP 200\)/
    );
});
