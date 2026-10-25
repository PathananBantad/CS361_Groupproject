/**
 * AWS Lambda Trigger: Post Authentication
 * Triggers after successful user authentication via Cognito (e.g., TU API / Thammasat SSO)
 *
 * Rules:
 * 1. Login ครั้งแรกของ user ที่ยังไม่มีกลุ่มใน Cognito:
 *    - ถ้า email ตรงกับ ADMIN_EMAILS (pathanan.ban@dome.tu.ac.th, pakhwan.jul@dome.tu.ac.th) -> ใส่เข้ากลุ่ม "admin"
 *    - ถ้าเป็น user ทั่วไป -> ใส่เข้ากลุ่ม "Staff/Instructor" เป็น default อัตโนมัติ
 * 2. Login ครั้งต่อๆ ไป:
 *    - ตรวจสอบก่อนว่า user มี group อยู่แล้วหรือยัง
 *    - ถ้ามีแล้ว (ไม่ว่าจะเป็น default หรือถูกเปลี่ยนโดย Admin ในภายหลัง) -> ห้ามใส่ซ้ำหรือ reset ทับ ให้ปล่อยผ่านทันที
 */

const {
    CognitoIdentityProviderClient,
    AdminListGroupsForUserCommand,
    AdminAddUserToGroupCommand
} = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient({});

// รายชื่ออีเมลที่ได้รับสิทธิ์ Admin อัตโนมัติเมื่อเข้าสู่ระบบครั้งแรก
const ADMIN_EMAILS = [
    "pathanan.ban@dome.tu.ac.th",
    "pakhwan.jul@dome.tu.ac.th"
];

// กลุ่มเริ่มต้นสำหรับผู้ใช้งานทั่วไปที่ดึงมาจาก TU API
const DEFAULT_STAFF_GROUP = "Staff/Instructor";
const ADMIN_GROUP = "admin";

exports.handler = async (event) => {
    console.log("PostAuthentication trigger started for user:", event.userName);

    const userPoolId = event.userPoolId;
    const userName = event.userName;
    const userAttributes = event.request?.userAttributes || {};
    const email = (userAttributes.email || userName || "").toLowerCase().trim();

    try {
        // 1. ตรวจสอบว่า user มีกลุ่ม (Cognito Group) อยู่แล้วหรือไม่
        const listGroupsCommand = new AdminListGroupsForUserCommand({
            UserPoolId: userPoolId,
            Username: userName
        });

        const listGroupsResponse = await cognitoClient.send(listGroupsCommand);
        const currentGroups = listGroupsResponse.Groups || [];

        console.log(`User [${userName} / ${email}] existing groups:`, currentGroups.map(g => g.GroupName));

        // 2. หากมีกลุ่มอยู่แล้ว (ไม่ว่าจะ default หรือถูกแก้ไขโดย Admin) ให้ปล่อยผ่าน ห้าม reset ทับ
        if (currentGroups.length > 0) {
            console.log(`User already has group(s) assigned: ${currentGroups.map(g => g.GroupName).join(", ")}. Skipping assignment.`);
            return event;
        }

        // 3. หากยังไม่มีกลุ่ม (Login ครั้งแรก): ตรวจสอบสิทธิ์ Admin หรือกำหนดเป็น Staff/Instructor
        let targetGroup = DEFAULT_STAFF_GROUP;
        if (ADMIN_EMAILS.includes(email)) {
            targetGroup = ADMIN_GROUP;
            console.log(`User matched Admin whitelist (${email}). Setting group to "${ADMIN_GROUP}".`);
        } else {
            console.log(`User has no groups (${email}). Setting default group to "${DEFAULT_STAFF_GROUP}".`);
        }

        const addGroupCommand = new AdminAddUserToGroupCommand({
            UserPoolId: userPoolId,
            Username: userName,
            GroupName: targetGroup
        });

        await cognitoClient.send(addGroupCommand);
        console.log(`Successfully added user [${userName}] to Cognito group "${targetGroup}".`);

    } catch (error) {
        console.error("Error in PostAuthentication trigger:", error);
        // ไม่โยน Error เพื่อให้ user ยังสามารถเข้าสู่ระบบได้ ไม่ติดค้าง
    }

    return event;
};
