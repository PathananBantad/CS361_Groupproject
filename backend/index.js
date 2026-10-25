const serverless = require("serverless-http");
const app = require("./server");

const serverlessHandler = serverless(app);

// รองรับ Cognito PostAuthentication Trigger ภายในฟังก์ชัน cs361-v2-documentflow-api ตัวเดิม
async function handleCognitoPostAuth(event) {
    console.log("PostAuthentication trigger started for user:", event.userName);
    const {
        CognitoIdentityProviderClient,
        AdminListGroupsForUserCommand,
        AdminAddUserToGroupCommand
    } = require("@aws-sdk/client-cognito-identity-provider");

    const userPoolId = event.userPoolId;
    const userName = event.userName;
    const userAttributes = event.request?.userAttributes || {};
    const email = (userAttributes.email || userName || "").toLowerCase().trim();

    const ADMIN_EMAILS = [
        "pathanan.ban@dome.tu.ac.th",
        "pakhwan.jul@dome.tu.ac.th"
    ];

    try {
        const cognitoClient = new CognitoIdentityProviderClient({});
        // 1. ตรวจสอบว่า user มีกลุ่มอยู่แล้วหรือไม่
        const listRes = await cognitoClient.send(new AdminListGroupsForUserCommand({
            UserPoolId: userPoolId,
            Username: userName
        }));
        const currentGroups = listRes.Groups || [];

        // 2. ถ้ามีกลุ่มอยู่แล้ว (ไม่ว่าจะเป็น default หรือแอดมินตั้งให้) -> ข้ามทันที ห้ามใส่ซ้ำหรือ reset ทับ
        if (currentGroups.length > 0) {
            console.log(`User [${userName}] already has groups: ${currentGroups.map(g => g.GroupName).join(", ")}. Skipping.`);
            return event;
        }

        // 3. Login ครั้งแรก (ยังไม่มีกลุ่ม): กำหนด Admin หรือ Staff/Instructor
        const targetGroup = ADMIN_EMAILS.includes(email) ? "admin" : "Staff/Instructor";
        await cognitoClient.send(new AdminAddUserToGroupCommand({
            UserPoolId: userPoolId,
            Username: userName,
            GroupName: targetGroup
        }));
        console.log(`Successfully added user [${userName}] to group "${targetGroup}".`);
    } catch (err) {
        console.error("PostAuthentication trigger error:", err);
    }
    return event;
}

module.exports.handler = async (event, context) => {
    if (context) {
        context.callbackWaitsForEmptyEventLoop = false;
    }
    // หากถูกเรียกจาก Cognito Post Authentication Trigger
    if (event && event.triggerSource && event.triggerSource.startsWith("PostAuthentication_")) {
        return await handleCognitoPostAuth(event);
    }
    // หากถูกเรียกจาก API Gateway (HTTP Web App)
    return await serverlessHandler(event, context);
};