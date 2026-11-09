const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getRequiredDatabaseConfig } = require("../../scripts/deploy-aws");

const validDatabaseConfig = {
    DB_HOST: "db.example.invalid",
    DB_PORT: "4000",
    DB_USER: "unit-test-user",
    DB_PASSWORD: "unit-test-password",
    DB_NAME: "unit_test"
};

test("deployment database configuration requires explicitly configured TiDB values", async t => {
    await t.test("accepts a complete configuration and preserves backend aliases", () => {
        assert.deepEqual(getRequiredDatabaseConfig(validDatabaseConfig), {
            ...validDatabaseConfig,
            DB_USERNAME: validDatabaseConfig.DB_USER,
            DB_DATABASE: validDatabaseConfig.DB_NAME
        });
    });

    await t.test("supports existing DB_USERNAME and DB_DATABASE aliases", () => {
        const { DB_USER, DB_NAME, ...config } = validDatabaseConfig;
        const result = getRequiredDatabaseConfig({
            ...config,
            DB_USERNAME: validDatabaseConfig.DB_USER,
            DB_DATABASE: validDatabaseConfig.DB_NAME
        });

        assert.equal(result.DB_USER, validDatabaseConfig.DB_USER);
        assert.equal(result.DB_USERNAME, validDatabaseConfig.DB_USER);
        assert.equal(result.DB_NAME, validDatabaseConfig.DB_NAME);
        assert.equal(result.DB_DATABASE, validDatabaseConfig.DB_NAME);
    });

    for (const [description, password] of [
        ["missing", undefined],
        ["empty", ""],
        ["whitespace-only", "   "]
    ]) {
        await t.test(`rejects a ${description} DB_PASSWORD without revealing values`, () => {
            assert.throws(
                () => getRequiredDatabaseConfig({ ...validDatabaseConfig, DB_PASSWORD: password }),
                error => {
                    assert.match(error.message, /DB_PASSWORD/);
                    assert.equal(error.message.includes(validDatabaseConfig.DB_PASSWORD), false);
                    return true;
                }
            );
        });
    }

    await t.test("rejects missing DB_HOST and DB_USER", () => {
        const config = { ...validDatabaseConfig };
        delete config.DB_HOST;
        delete config.DB_USER;

        assert.throws(
            () => getRequiredDatabaseConfig(config),
            error => {
                assert.match(error.message, /DB_HOST/);
                assert.match(error.message, /DB_USER/);
                assert.equal(error.message.includes(validDatabaseConfig.DB_PASSWORD), false);
                return true;
            }
        );
    });

    await t.test("requires DB_PORT and DB_NAME rather than using defaults", () => {
        const config = { ...validDatabaseConfig };
        delete config.DB_PORT;
        delete config.DB_NAME;

        assert.throws(
            () => getRequiredDatabaseConfig(config),
            error => {
                assert.match(error.message, /DB_PORT/);
                assert.match(error.message, /DB_NAME/);
                return true;
            }
        );
    });

    await t.test("production deployment has no hardcoded TiDB defaults and validates before AWS CLI", () => {
        const scriptPath = path.resolve(__dirname, "../../scripts/deploy-aws.js");
        const deployScript = fs.readFileSync(scriptPath, "utf8");
        const preflight = deployScript.indexOf("const databaseConfig = getRequiredDatabaseConfig();");
        const firstAwsCall = deployScript.indexOf("runAws('aws sts get-caller-identity')");

        assert.doesNotMatch(deployScript, /DB_HOST:\s*envConfig\.DB_HOST\s*\|\|/);
        assert.doesNotMatch(deployScript, /DB_PORT:\s*envConfig\.DB_PORT\s*\|\|/);
        assert.doesNotMatch(deployScript, /DB_USER:\s*envConfig\.DB_USER\s*\|\|/);
        assert.doesNotMatch(deployScript, /DB_PASSWORD:\s*envConfig\.DB_PASSWORD\s*\|\|/);
        assert.doesNotMatch(deployScript, /DB_NAME:\s*envConfig\.DB_NAME\s*\|\|/);
        assert.ok(preflight >= 0);
        assert.ok(firstAwsCall > preflight);
        assert.match(deployScript, /\.\.\.process\.env/);
        assert.match(deployScript, /\.\.\.envConfig/);
        assert.match(deployScript, /if \(require\.main === module\)/);
    });
});
