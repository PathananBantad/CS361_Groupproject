const {
    S3Client,
    GetObjectCommand,
    PutObjectCommand
} = require("@aws-sdk/client-s3");

const {
    getSignedUrl
} = require("@aws-sdk/s3-request-presigner");

require("dotenv").config();

const s3 = new S3Client({
    region: process.env.AWS_REGION
});

const bucketName = process.env.AWS_S3_BUCKET;


// Create upload URL
async function createUploadUrl(fileKey, contentType) {

    const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ContentType: contentType
    });

    return await getSignedUrl(s3, command, {
        expiresIn: 300
    });
}


// Create download URL
async function createDownloadUrl(fileKey) {

    const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ResponseContentType: "application/pdf",
        ResponseContentDisposition: "inline"
    });

    return await getSignedUrl(s3, command, {
        expiresIn: 300
    });
}


module.exports = {
    createUploadUrl,
    createDownloadUrl
};