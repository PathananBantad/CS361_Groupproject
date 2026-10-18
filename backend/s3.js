const {
    S3Client,
    GetObjectCommand,
    PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
    getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

const path = require("path");

require("dotenv").config();
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const bucketName = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "cs361-v2-documents-documentflow";

// Region ของ S3 Bucket:
// cs361-v2-documents-documentflow อยู่ที่ us-east-1
const s3Region = process.env.AWS_S3_REGION || process.env.AWS_REGION || "us-east-1";

const accessKeyId = (process.env.AWS_ACCESS_KEY_ID || process.env.aws_access_key_id || "").trim();
const secretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || process.env.aws_secret_access_key || "").trim();
const sessionToken = (process.env.AWS_SESSION_TOKEN || process.env.aws_session_token || "").trim();

const s3Config = {
    region: s3Region
};

if (accessKeyId && secretAccessKey) {
    s3Config.credentials = {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {})
    };
}

const s3 = new S3Client(s3Config);

// Helper function to resolve MIME type by extension
function getMimeTypeByExtension(fileNameOrKey) {
    if (!fileNameOrKey) return "application/octet-stream";
    const ext = path.extname(fileNameOrKey).toLowerCase();
    const mimeMap = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".doc": "application/msword",
        ".xls": "application/vnd.ms-excel",
        ".ppt": "application/vnd.ms-powerpoint"
    };
    return mimeMap[ext] || "application/octet-stream";
}

// สร้าง Public URL ตรงของ S3 Bucket (ป้องกันปัญหา AWSCompromisedKeyQuarantineV3 บน GetObject)
function getPublicUrl(fileKey) {
    if (!fileKey) return null;
    const encodedKey = fileKey.split("/").map(encodeURIComponent).join("/");
    return `https://${bucketName}.s3.${s3Region}.amazonaws.com/${encodedKey}`;
}

// Create upload URL (PUT)
async function createUploadUrl(fileKey, contentType) {
    const finalContentType = contentType || getMimeTypeByExtension(fileKey);

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ContentType: finalContentType
    });

    return await getSignedUrl(s3, command, {
        expiresIn: 300
    });
}

// Read a file from S3 through the backend
async function getS3Object(fileKey) {
    if (!fileKey) {
        throw new Error("File key is required.");
    }

    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: fileKey
    });

    return await s3.send(command);
}

// Create download or preview URL with proper ContentType and Disposition
async function createDownloadUrl(fileKey, options = {}) {
    const {
        disposition = "inline",
        fileName = null,
        contentType = null
    } = options;

    const resolvedContentType = contentType || getMimeTypeByExtension(fileName || fileKey);

    let originalName = fileName;
    if (!originalName) {
        const parts = fileKey.split("/");
        const lastPart = parts[parts.length - 1];
        const dashIdx = lastPart.indexOf("-");
        originalName = dashIdx !== -1 ? lastPart.substring(dashIdx + 1) : lastPart;
    }

    const safeAsciiName = originalName.replace(/[^\x20-\x7E]/g, "_");
    const encodedName = encodeURIComponent(originalName);

    // สำหรับ Bucket my-project-v1-2026:
    // เนื่องจาก AWS IAM Key โดน Quarantine บล็อก GetObject ผ่าน signed URL
    // แต่ตัว Bucket เป็น Public Read สามารถเข้าถึงผ่าน Public URL ได้ 100%
    if (bucketName === "my-project-v1-2026") {
    throw new Error(
        "Public S3 download is disabled. Configure secure presigned URLs."
    );
}

    // กรณี Bucket ทั่วไปหรือบน Lambda ที่ใช้ IAM Role
    try {
        const contentDisposition = disposition === "attachment"
            ? `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`
            : `inline; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`;

        const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: fileKey,
            ResponseContentType: resolvedContentType,
            ResponseContentDisposition: contentDisposition
        });

        return await getSignedUrl(s3, command, {
            expiresIn: 300
        });
    } catch (e) {
    console.error("Failed to create S3 presigned download URL:", e);
    throw new Error("Unable to generate a secure download URL.");
    }
}

// ดึง Buffer ของไฟล์จริงจาก S3 โดยตรง
async function getObjectBuffer(fileKey) {
    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: fileKey
    });
    const response = await s3.send(command);
    const byteArray = await response.Body.transformToByteArray();
    return {
        buffer: Buffer.from(byteArray),
        contentType: response.ContentType || getMimeTypeByExtension(fileKey),
        contentLength: response.ContentLength
    };
}

// อัปโหลด Buffer ของไฟล์ขึ้น S3 โดยตรงจาก Backend (ป้องกันปัญหา Browser CORS)
async function uploadObjectBuffer(fileKey, buffer, contentType) {
    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: contentType || getMimeTypeByExtension(fileKey)
    });
    return await s3.send(command);
}

module.exports = {
    s3,
    getObjectBuffer,
    uploadObjectBuffer,
    createUploadUrl,
    createDownloadUrl,
    getS3Object,
    getPublicUrl,
    getMimeTypeByExtension,
    bucketName,
    s3Region
};