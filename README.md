## Mailbox & Document Flow System(G6)

## Project Vision
พัฒนาระบบรับและกระจายเอกสารอิเล็กทรอนิกส์ให้เป็นแพลตฟอร์มกลางที่ช่วยจัดการเอกสารตั้งแต่การรับ ลงทะเบียน จัดเก็บ และส่งต่ออย่างเป็นระบบ ผู้ใช้สามารถติดตามสถานะและตรวจสอบการดำเนินงานย้อนหลังได้ ช่วยลดปัญหาเอกสารสูญหาย งานล่าช้า และความไม่ชัดเจนในการส่งต่องานระหว่างฝ่าย

## Primary User
- เจ้าหน้าที่รับเอกสาร: รับและลงทะเบียนเอกสาร กำหนดข้อมูลเบื้องต้น และส่งต่อไปยังผู้เกี่ยวข้อง
- อาจารย์ / เจ้าหน้าที่: รับเอกสารหรือภารกิจที่เกี่ยวข้อง ดูรายละเอียด และดำเนินการตามสิทธิ์ที่ได้รับ
- ผู้รับผิดชอบเรื่อง: ติดตามและดำเนินการเอกสารที่ได้รับมอบหมาย พร้อมปรับสถานะหรือส่งต่อเมื่อจำเป็น
- ผู้ดูแลระบบ: จัดการผู้ใช้ สิทธิ์ ประเภทเอกสาร และข้อมูลพื้นฐานที่เกี่ยวข้องกับระบบ
- ผู้บริหาร: ดูภาพรวมสถานะเอกสาร งานค้าง ระยะเวลาดำเนินการ และข้อมูลสรุปเพื่อการติดตาม
  
## Problem
ปัจจุบันการรับและกระจายเอกสารภายในองค์กรมีเอกสารเข้ามาจากหลายช่องทาง เช่น Email, Line, ส่งโดยเจ้าหน้าที่สาขา และหน่วยงานภายนอก ทำให้เกิดปัญหาในการจัดการเอกสาร เช่น

- ข้อมูลเกี่ยวกับประเภทเอกสารและรายละเอียดที่ต้องเตรียมไม่ชัดเจน
- การส่งต่อเอกสารระหว่างผู้เกี่ยวข้องหลายฝ่ายอาจเกิดความล่าช้า
- ไม่สามารถตรวจสอบกระบวนการดำเนินงาน และ การตรวจสอบย้อนหลังของเอกสารได้อย่างชัดเจน
- เอกสารเกิดการสูญหาย

ระบบ Electronic Mailbox & Document Flow System จึงถูกพัฒนาเพื่อช่วยจัดการกระบวนการสำหรับลงทะเบียน ส่งต่อ และติดตามเอกสารอย่างเป็นระบบ โดยมีเป้าหมายเพื่อเพิ่มความถูกต้อง ความสามารถในการตรวจสอบย้อนหลัง (Traceability) และลดปัญหาเอกสารตกหล่น

## V5 Goal
V5 มุ่งเน้นการทำให้ Infrastructure และ Deployment ที่สำคัญของระบบสามารถสร้างหรือปรับใช้ซ้ำได้ด้วย Automation / Infrastructure as Code ตามข้อกำหนดของรายวิชา

เป้าหมายของ V5 ได้แก่

1. จัดเก็บนิยาม Infrastructure ที่สำคัญเป็น Code และติดตามการเปลี่ยนแปลงผ่าน Version Control
2. ลดขั้นตอน Manual Configuration ในการสร้างหรือปรับปรุงระบบ
3. จัดทำกระบวนการ Build ตรวจสอบ และ Deploy ที่เรียกใช้ซ้ำได้
4. แยกค่าการตั้งค่าของแต่ละ Environment ออกจาก Application Code
5. จัดการข้อมูลลับและสิทธิ์ที่ใช้ในการ Deploy อย่างเหมาะสม
6. ตรวจสอบผลหลัง Deployment ว่าระบบยังรองรับการทำงานหลักจาก V1–V4
7. จัดทำหลักฐานแสดงการสร้างหรือปรับใช้ซ้ำ พร้อมอธิบายข้อจำกัดและ Trade-off

## ขอบเขตที่พัฒนาใน V5
1. Infrastructure as Code

กำหนด Resource และการตั้งค่าที่สำคัญของระบบผ่าน Code ตาม Architecture ที่ทีมเลือกใช้ เช่น

- ส่วนให้บริการ Frontend
- ส่วนประมวลผล Backend
- ฐานข้อมูลสำหรับ Metadata และข้อมูล Workflow
- พื้นที่จัดเก็บไฟล์เอกสาร
- สิทธิ์การเข้าถึงระหว่างองค์ประกอบของระบบ
- องค์ประกอบสนับสนุน Workflow และ Reliability ที่มีอยู่ใน V4

ระบุให้ชัดเจนว่า Resource ใดอยู่ภายใต้ IaC และ Resource ใดยังต้องเตรียมด้วยมือ พร้อมเหตุผล

2. Automated Deployment

จัดทำกระบวนการ Deployment ที่สามารถเรียกใช้ซ้ำได้ โดยมีขั้นตอนหลักดังนี้
การเปลี่ยนแปลง Code → ตรวจสอบความถูกต้อง → Build → สร้างหรือปรับปรุง Infrastructure → Deploy Application → ตรวจสอบการทำงาน
บันทึกผลของแต่ละขั้นตอนเพื่อช่วยตรวจสอบและวิเคราะห์เมื่อเกิดข้อผิดพลาด

3. Environment Configuration

- แยกค่าที่เปลี่ยนตาม Environment เช่น Endpoint ชื่อ Resource และค่าการเชื่อมต่อ
- กำหนดค่าผ่าน Configuration หรือ Parameters
- ไม่จัดเก็บ Password, Access Key หรือ Secret ลงใน Repository
- ระบุค่าที่ต้องเตรียมก่อนเริ่ม Deployment ให้ชัดเจน

4. Repeatability และการตรวจสอบผล

- ทดลองสร้างหรือปรับใช้ระบบซ้ำจาก Code และ Configuration ที่กำหนด
- ตรวจสอบว่าการเรียกใช้ซ้ำไม่สร้าง Resource ซ้ำโดยไม่จำเป็น
- ตรวจสอบว่าการปรับใช้ไม่ลบข้อมูลเอกสารเดิมโดยไม่ตั้งใจ
- เก็บหลักฐานผล Deployment และขั้นตอน Manual ที่ยังเหลืออยู่

5. Deployment Verification และ Recovery

ตรวจสอบเส้นทางการทำงานหลักหลัง Deployment เช่น

- ผู้ใช้เข้าสู่ระบบได้
- เจ้าหน้าที่ลงทะเบียนเอกสารและแนบไฟล์ได้
- ผู้มีสิทธิ์มอบหมายหรือส่งต่อเอกสารได้
- ผู้รับผิดชอบเปลี่ยนสถานะและดูประวัติการดำเนินงานได้
- ระบบแสดง Deadline และรายการเกินกำหนดได้
- ผู้ใช้ค้นหาและเข้าถึงเอกสารตามสิทธิ์ได้

กำหนดวิธีนำ Application เวอร์ชันก่อนหน้ากลับมาใช้งาน และระบุข้อจำกัดในการกู้คืน Infrastructure หรือการเปลี่ยนแปลงโครงสร้างข้อมูล

## V5 In scope
- คงความสามารถของระบบตามขอบเขต V1–V4
- จัดทำ Infrastructure as Code สำหรับองค์ประกอบสำคัญของระบบ
- จัดเก็บ Application Code, Infrastructure Code และ Deployment Configuration ใน Version Control
- ทำ Automation สำหรับขั้นตอน Build และ Deployment ที่สำคัญ
- แยก Configuration ตาม Environment
- จัดการ Secret และสิทธิ์สำหรับ Deployment โดยไม่ฝังข้อมูลลับใน Code
- ตรวจสอบการทำงานหลักหลัง Deployment
- ทดสอบการสร้างหรือปรับใช้ระบบซ้ำ
- จัดทำขั้นตอน Recovery และระบุข้อจำกัด
- จัดทำ V5 Architecture Documentation พร้อมเหตุผลและ Trade-off
- เก็บหลักฐานการทำงานของ Automation และผลการตรวจสอบ
  
## V5 Out of scope
- การเพิ่มฟีเจอร์ธุรกิจใหม่ที่ไม่จำเป็นต่อ Automation และ Deployment
- การเพิ่ม Dashboard สรุปสำหรับผู้บริหารตาม FR10 เป็นเป้าหมายหลักของ V5
- การวิเคราะห์และปรับปรุง Performance พร้อมหลักฐาน Before–After ซึ่งเป็นเป้าหมายหลักของ V6
- การปรับต้นทุนเชิงลึก ซึ่งจะพิจารณาร่วมกับ Performance ใน V6
- การบูรณาการและทบทวนคุณภาพ Architecture ทั้งระบบอย่างครบถ้วนตามขอบเขต V7
- การทำ Automation สำหรับขั้นตอนภายนอกที่เครื่องมือไม่รองรับ โดยต้องบันทึกขั้นตอนและเหตุผลไว้

## External actors / systems
### External Actors
- เจ้าหน้าที่และผู้รับผิดชอบเอกสาร: ใช้งานระบบและตรวจสอบว่า Workflow หลักยังทำงานได้หลัง Deployment
- ทีมพัฒนา: แก้ไข Code และตรวจสอบผลการ Build และ Deployment
- ผู้ดูแล Infrastructure: ดูแล Configuration สิทธิ์ และการกู้คืนเมื่อเกิดปัญหา
  
### External System
- GitHub: จัดเก็บ Source Code, Infrastructure Code และ Deployment Configuration ของ V5 รวมถึง GitHub Actions workflows สำหรับ CI และการ Deploy แบบ manual
- AWS: ให้บริการ AWS Amplify สำหรับ Web Application, Amazon Cognito สำหรับ Authentication, AWS Lambda Function URL สำหรับรับคำขอ API โดยตรง และ Amazon S3 สำหรับจัดเก็บไฟล์เอกสาร
- Amazon RDS for MySQL: ฐานข้อมูลภายนอกที่มีอยู่แล้วสำหรับข้อมูลเอกสาร ผู้ใช้ Workflow สถานะ และประวัติการดำเนินงาน ใช้พอร์ต 3306; V5 ไม่สร้าง RDS instance ใหม่
- GitHub Actions: รัน CI สำหรับ push/pull request และ workflow แบบ manual สำหรับ Deploy ไปยัง GitHub Environment ที่เลือก
- GitHub Environment variables/secrets: จัดเก็บค่าการตั้งค่าและ credentials ที่ workflow ใช้ โดยไม่ใส่ secret ลงใน workflow หรือ source code
  
## Open questions / To validate
- การปรับใช้ซ้ำมีผลต่อข้อมูลเอกสาร ไฟล์ และประวัติ Workflow หรือไม่?
- จะจัดการ Resource ที่สร้างด้วยมือไว้แล้วอย่างไร?

## Deploy link
(https://main.d29fui7wfvh5a0.amplifyapp.com/)

## Architecture V5
<img width="1755" height="896" alt="Architecture V5 " src="https://github.com/user-attachments/assets/290723a9-9ac3-4b68-b990-158593ee234f" />

## V5 Infrastructure as Code and Deployment

### Architecture and resource ownership

V5 keeps the existing architecture: AWS Amplify serves the static frontend; the frontend calls an AWS Lambda Function URL directly; Lambda validates Cognito access-token JWTs and applies document/role authorization; an existing Amazon RDS for MySQL instance stores metadata and workflow data; and S3 stores document files. The V5 templates do not create an RDS instance or API Gateway. The RDS database is external and is accessed on port `3306`. The TU authentication endpoint remains part of the backend login flow.

The CloudFormation templates are in `infra/cloudformation/`:

| Template/resource | Ownership and behavior |
|---|---|
| `artifact-bucket.json` | Creates the private, versioned deployment-artifact bucket in a separate CloudFormation stack. Public access is blocked and deletion/replacement retains the bucket. |
| `docuflow.json` Lambda, execution role, log group, Function URL and invoke permissions | Managed by the application stack. Names, environment, origins, Cognito pool, and runtime configuration are parameters. The public Function URL is `NONE` auth so the browser can call it; application endpoints continue to enforce Cognito JWT and authorization middleware. |
| Lambda VPC configuration | The application stack requires environment-specific `VPC_SUBNET_IDS` and `VPC_SECURITY_GROUP_IDS`; there are no subnet or security-group defaults. The execution role receives the ENI permissions required by Lambda VPC networking. Lambda RDS connections enable verified TLS with the bundled RDS CA. |
| Document S3 bucket | `DOCUMENT_BUCKET_MODE=Existing` references the supplied bucket without importing, changing, or deleting it. `Create` provisions a new private/versioned bucket with `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. |
| Existing Cognito User Pool and Amplify app | Remain externally managed. CloudFormation grants the configured pool permission to invoke Lambda but does not replace the pool's `LambdaConfig` or change the Amplify app. |
| Amazon RDS for MySQL | Remains external; only connection settings are passed to Lambda. No RDS instance is provisioned and no database migration is run by this deployment. |

The existing Cognito User Pool's PostAuthentication trigger association is intentionally a reviewed manual step: inspect the pool's current triggers first, then associate the output `CognitoPostAuthenticationLambdaArn` without overwriting other configured triggers. If the pool already has a PostAuthentication trigger, do not replace it without reviewing its behavior. Existing Lambda functions cannot be silently adopted by a new stack; the deployment script aborts if the selected function exists outside its stack. Import existing resources only through a separately reviewed CloudFormation resource-import/migration procedure.

An AWS read-only inspection was attempted before designing this deployment, but the current AWS CLI identity could not be verified, so it could not confirm the real account's stack ownership, bucket configuration, Lambda configuration, or Cognito triggers. No AWS resources were created, updated, or deleted. Do not target an existing production function or pool until those checks can be completed with valid read-only credentials. The untracked `scripts/inspect-aws-readonly.ps1` is retained unchanged.

### Prerequisites

- Node.js 22+ and npm.
- Run `npm --prefix backend ci` before local tests or packaging.
- AWS CLI v2.
- AWS permissions for CloudFormation stack operations, Lambda, S3 artifact upload, IAM role creation, and `sts:GetCallerIdentity`. The Lambda execution role created by the template is scoped to the configured document bucket and Cognito pool.
- An existing Cognito User Pool and App Client.
- An existing Amazon RDS for MySQL database, reachable by the Lambda VPC configuration, and its connection settings (MySQL port `3306`). This deployment does not create the database.
- Set `VPC_SUBNET_IDS` and `VPC_SECURITY_GROUP_IDS` to IDs in the selected AWS environment; no account-specific network IDs are assumed.
- An existing document bucket (recommended for the current deployment) or a globally unique name for a new bucket.
- An Amplify frontend origin for CORS. For a new document bucket, direct browser uploads/downloads also use the S3 CORS rule in the template. Existing bucket CORS is not changed by this deployment and must be reviewed/configured separately if needed.

### Environment variables

The deployment script accepts terminal environment variables and optionally reads `backend/.env` as a local fallback. Terminal variables take precedence. It does not require credentials to be stored in `.env`, does not pass AWS credentials to Lambda, and never modifies `.env`.

| Variable | Required | Purpose |
|---|---:|---|
| `AWS_REGION` (or `AWS_DEFAULT_REGION`) | Yes | Region for the CloudFormation stacks, Lambda, and artifact bucket. |
| `AWS_EXPECTED_ACCOUNT_ID` | Yes | Expected 12-digit AWS account ID. The script verifies the STS caller identity against it before reading or changing deployment stacks. |
| `DEPLOY_ENVIRONMENT` | No | `dev` by default; supported values are `dev`, `staging`, and `production`. |
| `CLOUDFORMATION_STACK_NAME` | No | Defaults to `docuflow-<environment>`. The artifact stack appends `-artifacts`. |
| `LAMBDA_FUNCTION_NAME` | No | Defaults to `docuflow-<environment>-api`. |
| `ARTIFACT_BUCKET_NAME` | Yes | Globally unique private bucket name for versioned Lambda packages. |
| `DOCUMENT_BUCKET_NAME` (or existing backend alias `S3_BUCKET`) | Yes | Existing document bucket name, or new bucket name when mode is `Create`. |
| `DOCUMENT_BUCKET_MODE` | No | `Existing` by default; use `Create` only for a new unique bucket. |
| `AWS_S3_REGION` | No | Document bucket region; defaults to `AWS_REGION`. |
| `FRONTEND_ALLOWED_ORIGINS` | Yes | Comma-separated HTTPS frontend origins. HTTP is allowed only for `localhost`/`127.0.0.1`. |
| `COGNITO_REGION` | No | Defaults to the region prefix of `COGNITO_USER_POOL_ID`. |
| `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID` | Yes | Existing Cognito pool and client identifiers. These identifiers are not secrets. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Yes | Existing Amazon RDS for MySQL connection; set `DB_PORT=3306`. `DB_USERNAME` and `DB_DATABASE` are accepted aliases. |
| `VPC_SUBNET_IDS`, `VPC_SECURITY_GROUP_IDS` | Yes | Comma-separated subnet and security-group IDs for the target environment's Lambda VPC. |
| `SESSION_SECRET` | Yes | Session signing secret. |
| `COGNITO_CLIENT_SECRET` | No | Only if the existing Cognito App Client has a client secret. |
| `TU_API_URL` | No | Defaults to the existing TU API endpoint. |
| `TU_API_KEY` (or `TU_APP_KEY`) | Depends | Needed for the existing TU authentication flow. |

`DB_PASSWORD`, `SESSION_SECRET`, `TU_API_KEY`, and `COGNITO_CLIENT_SECRET` are CloudFormation `NoEcho` parameters, which masks their values in CloudFormation stack parameter displays. `NoEcho` is not Secrets Manager and does not prevent a secret from being exposed wherever the template passes it. In particular, `DB_PASSWORD` is passed to the Lambda function as an environment variable; principals authorized to inspect the Lambda configuration may be able to access it. This is a current security limitation that should be improved in a future change by retrieving the database credential from a managed secret store. The deployment script creates a short-lived parameter file outside the repository and removes it in a `finally` block. AWS Academy credentials must never be copied into application Lambda variables.

### Preparing AWS Academy temporary credentials

In the terminal used for local deployment, export the temporary key, secret, and session token supplied by AWS Academy (PowerShell example):

```powershell
$env:AWS_ACCESS_KEY_ID = "<temporary access key>"
$env:AWS_SECRET_ACCESS_KEY = "<temporary secret key>"
$env:AWS_SESSION_TOKEN = "<temporary session token>"
$env:AWS_REGION = "us-east-1"
$env:AWS_EXPECTED_ACCOUNT_ID = "<12-digit expected AWS account ID>"
aws sts get-caller-identity
```

Temporary credentials expire; obtain a fresh set before deploying. Do not paste them into workflow YAML, source files, command history, or a committed file. The deployment script uses the AWS CLI credential provider chain and supports environment credentials, including `AWS_SESSION_TOKEN`, as well as an AWS CLI profile.

### Create or update CloudFormation and deploy Lambda

Set the required runtime and resource configuration in the terminal or `backend/.env` (ignored by Git). Example names below are placeholders; choose unique bucket names and use the actual project environment settings:

```powershell
$env:DEPLOY_ENVIRONMENT = "dev"
$env:ARTIFACT_BUCKET_NAME = "<unique-private-artifact-bucket>"
$env:DOCUMENT_BUCKET_NAME = "<existing-document-bucket>"
$env:DOCUMENT_BUCKET_MODE = "Existing"
$env:FRONTEND_ALLOWED_ORIGINS = "https://<your-amplify-domain>"
$env:COGNITO_USER_POOL_ID = "<existing-pool-id>"
$env:COGNITO_APP_CLIENT_ID = "<existing-app-client-id>"
$env:AWS_EXPECTED_ACCOUNT_ID = "<12-digit expected AWS account ID>"
$env:DB_HOST = "<existing-rds-mysql-endpoint>"
$env:DB_PORT = "3306"
$env:DB_USER = "<rds-mysql-user>"
$env:DB_PASSWORD = "<rds-mysql-password>"
$env:DB_NAME = "<rds-mysql-database>"
$env:VPC_SUBNET_IDS = "<private-subnet-id-1>,<private-subnet-id-2>"
$env:VPC_SECURITY_GROUP_IDS = "<lambda-security-group-id>"
$env:SESSION_SECRET = "<session-secret>"
node scripts\deploy-aws.js
```

The deployment script validates configuration before making AWS calls, verifies both the configured region and caller account, and checks existing stack/resource ownership. It packages the backend, creates or updates the private artifact-bucket CloudFormation stack, uploads the package under a content-based SHA-256 key (skipping an identical existing artifact), then creates or updates the application stack with the Lambda and VPC parameters. It waits for Lambda and requires `/api/health` to report a connected database. It refuses to target `cs361-v2-documentflow-api`, does not adopt a Lambda that exists outside its stack, does not mutate the existing document bucket, and does not update Cognito triggers. CloudFormation failures are surfaced and are not treated as successful deployments.

After deployment, manually review the existing Cognito User Pool's trigger configuration and set its PostAuthentication trigger to the stack output only if that does not overwrite another trigger. For existing document buckets, review their public-access block, encryption, and CORS without changing document data. In particular, do not enable public S3 access.

The frontend's primary endpoint is configured as `AWS_LAMBDA_FUNCTION_URL` in `frontend/js/cognito-config.js`; its current value is a Lambda Function URL, not an API Gateway URL. The deployment script intentionally does not rewrite frontend source configuration. For a different environment, update the frontend's public Cognito identifiers and Function URL through the frontend's reviewed environment-specific configuration/build process, then verify the Amplify origin is included in `FRONTEND_ALLOWED_ORIGINS`.

### CI and GitHub Actions

`.github/workflows/ci.yml` runs on pushes, pull requests, or manual dispatch. It installs backend dependencies with `npm ci`, checks JavaScript syntax, and runs all backend tests. `.github/workflows/deploy.yml` is manual (`workflow_dispatch`) with `dev`, `staging`, and `production` choices. It installs dependencies, runs tests and deployment-configuration validation, blocks production deployments from branches other than `main`, configures AWS credentials, verifies the caller identity, and invokes `node scripts/deploy-aws.js`. Configure required reviewers on the GitHub `production` Environment.

Create GitHub Environments named `dev`, `staging`, and/or `production`. Configure these environment variables as appropriate: `AWS_REGION`, `AWS_S3_REGION`, `AWS_EXPECTED_ACCOUNT_ID`, `CLOUDFORMATION_STACK_NAME`, `LAMBDA_FUNCTION_NAME`, `ARTIFACT_BUCKET_NAME`, `DOCUMENT_BUCKET_NAME`, `DOCUMENT_BUCKET_MODE`, `FRONTEND_ALLOWED_ORIGINS`, `VPC_SUBNET_IDS`, `VPC_SECURITY_GROUP_IDS`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `DB_PORT`, `DB_NAME`, and `TU_API_URL`.

Configure these environment secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `SESSION_SECRET`, `COGNITO_CLIENT_SECRET` (if applicable), and `TU_API_KEY` (if TU login is enabled). AWS Academy environments commonly issue temporary credentials and may not permit configuring an OIDC provider/role. This workflow therefore uses GitHub Environment secrets for the temporary three-part credentials; refresh them after expiry. OIDC is not assumed to be available. If the AWS account later supports OIDC, prefer a narrowly scoped role and GitHub repository/branch trust over long-lived credentials.

### Tests and deployment verification

Run the backend unit and automated tests locally:

```powershell
npm --prefix backend ci
npm --prefix backend test
```

The deployment tests cover environment validation, AWS Academy session-token propagation, caller identity validation, CloudFormation parameter mapping and resource safeguards, template security/outputs, and health-check failure handling. They do not contact AWS.

The deployment script's health check requires both HTTP success and `{ "ok": true, "database": "connected" }`. After a successful deploy, verify the CloudFormation outputs (`LambdaArn`, `FunctionUrl`, and `DocumentBucketName`), test the health URL, then run authenticated smoke tests for login, document listing/authorization, upload/download, assignments, status changes, and audit history. Protected APIs should reject requests without a valid Cognito access token.

The optional `scripts/verify-services.js` smoke test requires `DEPLOY_ENVIRONMENT`, `AWS_REGION`, `AWS_EXPECTED_ACCOUNT_ID`, `V5_VERIFY_S3_BUCKET`, and `V5_VERIFY_FUNCTION_URL`. It checks the AWS caller account before writing a temporary object, refuses V2 targets, and removes the object in a `finally` cleanup path.

The optional RDS tunnel helper requires explicit `-Region`, `-ExpectedAccountId`, `-RdsInstanceIdentifier`, and `-BastionInstanceId` parameters. It uses the AWS CLI credential provider chain and verifies the caller account before opening the SSM tunnel.

To roll back application code, identify a previously uploaded package key in the retained/versioned artifact bucket and update the application stack's `LambdaPackageKey` to that key using a reviewed CloudFormation change. Database migrations and existing document files are not rolled back by this procedure. Buckets and logs have retention policies; deletion/replacement does not purge their data automatically.

### Creating a new environment

Choose a supported `DEPLOY_ENVIRONMENT`, distinct `CLOUDFORMATION_STACK_NAME` and `LAMBDA_FUNCTION_NAME`, globally unique artifact bucket, and environment-specific document bucket/configuration. Use `DOCUMENT_BUCKET_MODE=Create` only for a new empty bucket; the template blocks all public access, enables encryption/versioning, and retains it on stack deletion/replacement. Set the existing RDS MySQL connection details (port `3306`), Cognito, TU API, CORS, account guard, and secret values for that environment before running the deployment. Existing resources must be explicitly identified and reviewed; never point a new stack at an existing Lambda name and assume CloudFormation will adopt it.
