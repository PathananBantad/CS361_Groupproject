const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { once } = require("node:events");

const sessionModulePath = require.resolve("../session");

function loadSessionMiddleware(secret) {
    const previousSecret = process.env.SESSION_SECRET;
    delete require.cache[sessionModulePath];

    if (secret === undefined) {
        delete process.env.SESSION_SECRET;
    } else {
        process.env.SESSION_SECRET = secret;
    }

    try {
        return require("../session");
    } finally {
        if (previousSecret === undefined) {
            delete process.env.SESSION_SECRET;
        } else {
            process.env.SESSION_SECRET = previousSecret;
        }
        delete require.cache[sessionModulePath];
    }
}

test("session configuration requires an explicitly provided non-empty secret", async t => {
    await t.test("accepts a configured secret", () => {
        assert.equal(typeof loadSessionMiddleware("unit-test-session-secret"), "function");
    });

    await t.test("fails when the secret is missing", () => {
        assert.throws(() => loadSessionMiddleware(undefined), {
            message: "Session configuration is missing"
        });
    });

    await t.test("fails when the secret is empty", () => {
        assert.throws(() => loadSessionMiddleware(""), {
            message: "Session configuration is missing"
        });
    });

    await t.test("fails when the secret contains only whitespace", () => {
        assert.throws(() => loadSessionMiddleware("   "), {
            message: "Session configuration is missing"
        });
    });

    await t.test("deployment configuration has no hardcoded default and validates before AWS calls", () => {
        const deployScript = fs.readFileSync(
            path.resolve(__dirname, "../../scripts/deploy-aws.js"),
            "utf8"
        );
        const validationCall = deployScript.indexOf("const sessionSecret = getRequiredSessionSecret();");
        const firstAwsCall = deployScript.indexOf("runAws('aws sts get-caller-identity')");

        assert.doesNotMatch(deployScript, /SESSION_SECRET\s*:\s*envConfig\.SESSION_SECRET\s*\|\|/);
        assert.doesNotMatch(deployScript, /SESSION_SECRET\s*\|\|\s*['"`]/);
        assert.ok(validationCall >= 0);
        assert.ok(firstAwsCall > validationCall);
        assert.match(deployScript, /SESSION_SECRET:\s*sessionSecret/);
    });

    await t.test("session middleware persists and reads a session when configured", async t => {
        const sessionMiddleware = loadSessionMiddleware("unit-test-session-secret");
        const app = express();
        app.use(sessionMiddleware);
        app.get("/set", (req, res) => {
            req.session.marker = "session-active";
            res.status(200).send("stored");
        });
        app.get("/read", (req, res) => {
            res.status(200).send(req.session.marker || "missing");
        });

        const server = app.listen(0, "127.0.0.1");
        await once(server, "listening");
        t.after(() => new Promise(resolve => server.close(resolve)));

        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const setResponse = await fetch(`${baseUrl}/set`);
        assert.equal(setResponse.status, 200);
        const cookie = setResponse.headers.get("set-cookie")?.split(";")[0];
        assert.ok(cookie);

        const readResponse = await fetch(`${baseUrl}/read`, {
            headers: { Cookie: cookie }
        });
        assert.equal(readResponse.status, 200);
        assert.equal(await readResponse.text(), "session-active");
    });
});
