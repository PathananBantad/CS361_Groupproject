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

const bucketName = process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || "cs361-v2-documents-documentflow";

// Region ของ S3 Bucket:
// cs361-v2-documents-documentflow อยู่ที่ us-east-1
const s3Region = process.env.AWS_S3_REGION || process.env.AWS_REGION || "us-east-1";

const s3 = new S3Client({
    region: s3Region
});

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
        return getPublicUrl(fileKey);
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
        // Fallback to public URL
        return getPublicUrl(fileKey);
    }
}

module.exports = {
    createUploadUrl,
    createDownloadUrl,
    getPublicUrl,
    getMimeTypeByExtension,
    bucketName,
    s3Region
};