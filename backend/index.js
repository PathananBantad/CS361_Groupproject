const serverless = require("serverless-http");
const app = require("./server");

const serverlessHandler = serverless(app);

module.exports.handler = async (event, context) => {
    if (context) {
        context.callbackWaitsForEmptyEventLoop = false;
    }
    return await serverlessHandler(event, context);
};