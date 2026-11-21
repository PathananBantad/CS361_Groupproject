# API Contract V7

ไฟล์นี้คือ **สเปก API ตัวหลัก** ของรอบ V7 (#76) ครอบคลุม #75 Share Link, #77 Inbox, #79 หัวหน้าสาขา และ #91 เปิดไฟล์ผ่าน S3

## กติกา

1. **ใช้ได้ทันที ไม่ต้องรอรีวิว** ใครทำ Backend หรือ Frontend ที่ต้องเชื่อมกับ endpoint ในไฟล์นี้ ให้ใช้ชื่อ path, field และ error code ตามนี้ทุกตัว
2. **อยากเปลี่ยน ให้แก้ไฟล์นี้ใน PR เดียวกับโค้ด** แล้วบอกในคอมเมนต์ของ #76 ว่าเปลี่ยนอะไร ห้ามเปลี่ยนชื่อ field ในโค้ดฝั่งเดียวโดยไม่แก้ไฟล์นี้
3. **เพิ่มได้ แต่ห้ามลบหรือเปลี่ยนชื่อ** Backend ส่ง field เพิ่มได้ Frontend ต้องไม่พังเมื่อเจอ field ที่ไม่รู้จัก แต่การลบหรือเปลี่ยนชื่อ field ที่อยู่ในไฟล์นี้ถือเป็นการเปลี่ยนสเปก (ต้องทำตามข้อ 2)
4. Schema ของ DB ใช้ [ERD-V7.md](ERD-V7.md) ไฟล์นี้ไม่สร้างตารางหรือคอลัมน์ใหม่

สถานะของแต่ละ endpoint: ✅ ทำแล้วใน `main` · 🔜 ยังไม่ทำ (ให้ทำตามสเปกนี้)

## ข้อตกลงร่วม

| เรื่อง | ข้อตกลง |
|---|---|
| Base URL | `/api` (frontend ใช้ `window.resolveApiBaseUrl()`) |
| Auth | `Authorization: Bearer <Cognito access token>` ทุก endpoint ยกเว้นที่ระบุว่า Public |
| วันที่ | `DATE` เป็น `"YYYY-MM-DD"` ส่วน `TIMESTAMP` เป็น ISO 8601 UTC เช่น `"2026-11-24T15:11:51.000Z"` |
| Boolean | `true` / `false` (frontend รับ `1` / `0` ได้ด้วย แต่ endpoint ใหม่ต้องส่ง boolean) |
| Error | `{ "error": "<ข้อความ>", "code": "<CODE>" }` endpoint ใหม่ต้องมี `code` ทุกครั้ง |
| ข้อมูลส่วนตัว | ห้ามส่ง `token_hash`, `password`, `cognito_sub` ใน response ใด ๆ |

### Status code มาตรฐาน

| Status | ความหมาย | `code` |
|---|---|---|
| 400 | ข้อมูลที่ส่งมาไม่ถูกต้อง | `INVALID_*` เช่น `INVALID_DOCUMENT_ID`, `INVALID_EXPIRY` |
| 401 | ไม่มี token หรือ token ไม่ถูกต้อง | (ตาม `cognito-auth.js`) |
| 403 | login แล้วแต่ไม่มีสิทธิ์ | `FORBIDDEN` |
| 404 | ไม่พบ | `DOCUMENT_NOT_FOUND`, `SHARE_LINK_NOT_FOUND`, `SHARE_LINK_UNAVAILABLE` |
| 409 | สถานะเอกสารไม่อนุญาตให้ทำสิ่งนี้ตอนนี้ | `HEAD_REVIEW_REQUIRED`, `HEAD_REVIEW_ASSIGNEE_MISMATCH`, `INVALID_REVIEW_STATE` |
| 429 | เรียกถี่เกินไป | `RATE_LIMITED` |

### Role

| Role (DB) | Cognito Group | ใช้ใน |
|---|---|---|
| `document_officer` | `DocumentReceiver` | ทุกหัวข้อ |
| `admin` | `Admin` | ทุกหัวข้อ |
| `faculty_staff` | `Staff/Instructor` | Inbox, Share Link |
| `responsible_person` | `ResponsiblePerson` | Inbox, Share Link |
| `executive` | `Executive` | อ่านอย่างเดียว |
| `branch_head` 🔜 | `BranchHead` | #79 (มีแถวใน `roles` แล้ว แต่ยังต้องเพิ่มใน `ROLES` และ `COGNITO_GROUP_BY_ROLE` ของ `documentAuthorization.js`) |

---

## #75 Share Link ✅

แทนโหมด Guest เดิม ทำแล้วใน `backend/shareLinks.js` (PR #98)

| Method | Path | Auth | สิทธิ์ |
|---|---|---|---|
| POST | `/api/documents/:id/share-links` | Bearer | `permissions.share` ของเอกสารนั้น |
| GET | `/api/documents/:id/share-links` | Bearer | `permissions.share` |
| DELETE | `/api/share-links/:id` | Bearer | `permissions.share` ของเอกสารที่ลิงก์ชี้ไป |
| GET | `/api/shared/:token` | **Public** (rate limit 30 ครั้ง/นาที/IP) | ใครก็ได้ที่มี token |

`permissions.share` เป็น `true` สำหรับ admin, document_officer และผู้รับผิดชอบปัจจุบัน (`assignee_id`) ของเอกสาร เป็น `false` สำหรับ executive และผู้รับเดิม

### POST `/api/documents/:id/share-links`

Request body (ไม่ส่ง body ได้):
```json
{ "expires_in_hours": 72 }
```
`expires_in_hours` ต้องเป็นจำนวนเต็ม 1–720 ค่าเริ่มต้น 72

Response `201` (**`token` มีครั้งเดียวตรงนี้** server ไม่เก็บไว้ เปิดดูซ้ำไม่ได้):
```json
{
  "id": 4,
  "document_id": 660064,
  "created_by": 2100098,
  "created_by_name": null,
  "expires_at": "2026-11-24T15:11:51.000Z",
  "revoked_at": null,
  "last_used_at": null,
  "created_at": "2026-11-21T15:11:51.000Z",
  "status": "active",
  "token": "<43 ตัวอักษร base64url>"
}
```
URL ที่ให้ผู้รับเปิด: `html/shared.html?token=<token>`

Error: `400 INVALID_EXPIRY`, `403 FORBIDDEN`, `404 DOCUMENT_NOT_FOUND`

### GET `/api/documents/:id/share-links`

Response `200` เป็น array (ใหม่สุดก่อน) แต่ละแถวเหมือน response ของ POST แต่**ไม่มี `token`** และ `status` เป็น `"active" | "expired" | "revoked"`

### DELETE `/api/share-links/:id`

Response `200` คือลิงก์หลังยกเลิก (`status: "revoked"`) ถ้าเรียกซ้ำกับลิงก์ที่ยกเลิกแล้วก็ได้ `200` เหมือนเดิม

Error: `403 FORBIDDEN`, `404 SHARE_LINK_NOT_FOUND`

### GET `/api/shared/:token` (Public)

Response `200`:
```json
{
  "document": {
    "reference_no": "DOC-20261122-0001",
    "document_number": null,
    "subject": "ขอเชิญประชุม",
    "document_type": "บันทึกข้อความ",
    "receive_date": "2026-11-20T17:00:00.000Z",
    "file_name": "invite.pdf",
    "file_size": 70897,
    "mime_type": "application/pdf",
    "can_preview": true
  },
  "link_expires_at": "2026-11-24T15:11:51.000Z",
  "preview_url": "https://<bucket>.s3.amazonaws.com/...X-Amz-Expires=120...",
  "download_url": "https://<bucket>.s3.amazonaws.com/...X-Amz-Expires=120...",
  "url_expires_in": 120
}
```
- `preview_url` เป็น `null` เมื่อไฟล์ preview ไม่ได้ (preview ได้เฉพาะ `.pdf .jpg .jpeg .png`) ส่วน `preview_url` และ `download_url` เป็น `null` ทั้งคู่เมื่อเอกสารไม่มีไฟล์
- URL หมดอายุใน 120 วินาที ถ้าผู้ใช้กดปุ่มทีหลัง frontend ต้องเรียก endpoint นี้ใหม่เพื่อเอา URL ใหม่ (`shared.js` ทำอยู่แล้ว)
- token ไม่ถูกต้อง, หมดอายุ หรือถูกยกเลิก ได้ **`404 SHARE_LINK_UNAVAILABLE` เหมือนกันทุกกรณี** frontend ห้ามแสดงเหตุผลแยกกรณี
- ตอบ `Cache-Control: no-store` และ `Referrer-Policy: no-referrer`
- Audit: `SHARE_LINK_CREATE`, `SHARE_LINK_OPEN`, `SHARE_LINK_REVOKE`

---

## #77 Inbox 🔜

ขยาย `GET /api/documents` และ `GET /api/documents/:id` ที่มีอยู่แล้ว ไม่สร้าง endpoint list ใหม่ Frontend (`dashboard.js`, `inbox.js`) อ่าน field เหล่านี้อยู่แล้ว

### GET `/api/documents` (เพิ่ม query และ field)

Query ใหม่ (ใช้ร่วมกับ filter เดิมได้ทุกตัว):

| Query | ค่า | ความหมาย |
|---|---|---|
| `sort` | `priority` (ค่าเริ่มต้น) \| `due` | `priority` = สูตร Inbox ใน [ERD-V7.md](ERD-V7.md#สูตร-priority-ของ-inbox-อาจารย์) (`buildInboxOrderBy`) ส่วน `due` = `deadline` ใกล้ก่อน และไม่มี deadline อยู่ท้าย |
| `group` | `action` \| `info` | เอาเฉพาะ "ต้องดำเนินการ" หรือ "เพื่อทราบ" |
| `pinned` | `1` | เอาเฉพาะที่ผู้ดูปักดาวไว้ |

ค่าที่ไม่รู้จักได้ `400 INVALID_QUERY`

Envelope เดิม: `{ "data": [...], "total": <จำนวน> }` แต่ละแถวเพิ่ม field:

| Field | Type | ความหมาย |
|---|---|---|
| `is_pinned` | boolean | ผู้ดูคนนี้ปักดาวเอกสารนี้ (`document_pins`) |
| `is_new` | boolean | `true` เมื่อผู้ดูเป็นผู้รับปัจจุบัน และแถวมอบหมายล่าสุดที่ส่งถึงผู้ดูยังมี `seen_at IS NULL` ถ้าไม่ใช่ผู้รับปัจจุบันเป็น `false` เสมอ |
| `action_group` | `"action"` \| `"info"` | หมวดตาม `inboxCategory(document_type)` ประเภทที่ไม่รู้จักนับเป็น `"action"` |
| `priority_level` | `0` \| `1` \| `2` | `0` = ปักดาว, `1` = ต้องดำเนินการ, `2` = เพื่อทราบ (ตรงกับ `priority()` ใน `inbox.js`) |
| `is_overdue` | boolean | `isOverdue(deadline)` เป็นป้ายเท่านั้น ไม่มีผลต่อลำดับ |
| `is_official` | boolean | จาก #79 (ส่งมาด้วยเพื่อใช้แสดงป้าย) |
| `review_state` | `null` \| `"PENDING"` \| `"DIRECTED"` \| `"RETURNED"` \| `"DONE"` | จาก #79 |
| `head_review` | object \| `null` | คำสั่งการล่าสุดของหัวหน้าสาขา (ดู #79) frontend อ่าน `head_review.note` อยู่แล้ว |

ตัวอย่างแถว (เฉพาะ field ใหม่ที่ต่อจาก field เดิม):
```json
{
  "id": 660064,
  "reference_no": "DOC-20261122-0001",
  "document_type": "ขออนุมัติ",
  "deadline": "2026-11-25",
  "is_pinned": false,
  "is_new": true,
  "action_group": "action",
  "priority_level": 1,
  "is_overdue": false,
  "is_official": true,
  "review_state": "DIRECTED",
  "head_review": { "id": 12, "decision": "DIRECTED", "assignee_id": 2100100, "assignee_name": "อ.ผู้รับ", "note": "ดำเนินการให้ทันวันศุกร์", "reason": null, "head_name": "ผศ.ตัวอย่าง", "created_at": "2026-11-22T03:00:00.000Z" }
}
```

> ⚠️ ห้ามได้แถวซ้ำ ใช้วิธี JOIN แถวล่าสุดตามที่เขียนไว้ใน [ERD-V7.md](ERD-V7.md#index-90) (`a.id = (SELECT MAX(a2.id) ...)`)

### GET `/api/documents/:id` (เพิ่ม field และ side effect)

- เพิ่ม field เดียวกับตารางข้างบน (`is_pinned`, `is_new`, `action_group`, `priority_level`, `is_overdue`, `is_official`, `review_state`, `head_review`)
- **Side effect:** ถ้าผู้ดูเป็นผู้รับปัจจุบัน ให้ตั้ง `seen_at = CURRENT_TIMESTAMP` ในแถวมอบหมายล่าสุดที่ส่งถึงผู้ดูซึ่งยังเป็น `NULL` (ตั้งครั้งเดียว ไม่เขียนทับ) ใน response ให้ส่ง `is_new` เป็นค่า**ก่อน**อัปเดต
- `permissions` เพิ่ม `pin: true` เมื่ออ่านเอกสารได้

### PUT / DELETE `/api/documents/:id/pin`

| Method | ผล | Response |
|---|---|---|
| PUT | ปักดาว (ปักซ้ำได้ ไม่ error) | `200 { "document_id": 660064, "is_pinned": true }` |
| DELETE | เลิกปักดาว (ไม่ได้ปักไว้ก็ไม่ error) | `200 { "document_id": 660064, "is_pinned": false }` |

ทุก role ที่อ่านเอกสารได้ (`canAccessDocument(..., "read")`) ปักดาวได้ ดาวเป็นของแต่ละคน

Error: `403 FORBIDDEN`, `404 DOCUMENT_NOT_FOUND`

---

## #79 หัวหน้าสาขา (หนังสือราชการ) 🔜

### Flow

```
ลงทะเบียน is_official=true ──► PENDING ──(หัวหน้าสั่งการ)──► DIRECTED ──(สารบรรณแจกจ่าย/assign)──► DONE
                                  ▲   └──(หัวหน้าส่งกลับ)──► RETURNED
                                  └────────(สารบรรณส่งใหม่)───────┘
```
- เอกสารที่ `is_official = false` มี `review_state = NULL` และทำงานแบบเดิมทุกอย่าง
- ทุกครั้งที่หัวหน้าสั่งการหรือส่งกลับ ให้ INSERT แถวใน `document_head_reviews` (append-only) แล้วอัปเดต `documents.review_state`
- Audit event ใหม่: `HEAD_REVIEW_DIRECT`, `HEAD_REVIEW_RETURN`, `HEAD_REVIEW_RESUBMIT`

### POST `/api/documents` (เพิ่ม field)

Request เพิ่ม `"is_official": true` (optional ค่าเริ่มต้น `false`) ถ้าเป็น `true` จะได้ `review_state = "PENDING"` ทันที Response `201` เพิ่ม `is_official` และ `review_state`

### กติกา 409 ตอนแจกจ่าย

`POST /api/documents/:id/assign` และ `POST /api/documents/:id/forward` กับเอกสารที่ `is_official = true` ทำได้เฉพาะตอน `review_state = "DIRECTED"` ถ้าอยู่สถานะอื่นได้:
```json
{ "error": "หนังสือราชการต้องผ่านการสั่งการของหัวหน้าสาขาก่อน", "code": "HEAD_REVIEW_REQUIRED", "review_state": "PENDING" }
```
ตอน `DIRECTED` ต้อง assign ให้ `head_review.assignee_id` เท่านั้น ถ้าส่ง `assignee_id` คนอื่นได้ `409 HEAD_REVIEW_ASSIGNEE_MISMATCH` (frontend ควรเลือกผู้รับคนนี้ให้อัตโนมัติ) ถ้า assign สำเร็จให้เปลี่ยนเป็น `review_state = "DONE"` admin ไม่ได้รับการยกเว้นกติกานี้

### GET `/api/head/reviews`

สิทธิ์: `branch_head`, `admin` · Query: `state=PENDING` (ค่าเริ่มต้น) \| `RETURNED` \| `DIRECTED` \| `DONE`

Response `200`:
```json
{
  "data": [
    {
      "id": 660070,
      "reference_no": "DOC-20261122-0003",
      "subject": "ขออนุมัติจัดโครงการ",
      "document_type": "ขออนุมัติ",
      "receive_date": "2026-11-22",
      "deadline": "2026-11-29",
      "review_state": "PENDING",
      "submitted_at": "2026-11-22T02:10:00.000Z",
      "head_review": null
    }
  ],
  "total": 1
}
```
เรียงตาม `submitted_at` เก่าก่อน (`submitted_at` = เวลาที่เข้าสถานะ `PENDING` ล่าสุด)

### POST `/api/documents/:id/head-review`

สิทธิ์: `branch_head` · ต้องอยู่สถานะ `PENDING` (ถ้าไม่ใช่ได้ `409 INVALID_REVIEW_STATE`)

| decision | field ที่ต้องส่ง | ผล |
|---|---|---|
| `DIRECTED` | `assignee_id` (บังคับ), `note` (optional) | `review_state = "DIRECTED"` และสารบรรณเห็นว่าต้องแจกจ่ายให้ `assignee_id` |
| `RETURNED` | `reason` (บังคับ, ไม่ว่าง) | `review_state = "RETURNED"` และกลับไปหาสารบรรณ |

```json
{ "decision": "DIRECTED", "assignee_id": 2100100, "note": "ดำเนินการให้ทันวันศุกร์" }
```
```json
{ "decision": "RETURNED", "reason": "แนบเอกสารประกอบไม่ครบ" }
```
Response `201`:
```json
{
  "document_id": 660070,
  "review_state": "DIRECTED",
  "head_review": { "id": 12, "decision": "DIRECTED", "assignee_id": 2100100, "assignee_name": "อ.ผู้รับ", "note": "ดำเนินการให้ทันวันศุกร์", "reason": null, "head_name": "ผศ.ตัวอย่าง", "created_at": "2026-11-22T03:00:00.000Z" }
}
```
Error: `400 INVALID_DECISION` (decision ผิด / ไม่ส่ง `assignee_id` ตอน DIRECTED / ไม่ส่ง `reason` ตอน RETURNED), `403 FORBIDDEN`, `404 DOCUMENT_NOT_FOUND`, `409 INVALID_REVIEW_STATE`

### POST `/api/documents/:id/resubmit`

สิทธิ์: `document_officer`, `admin` · ต้องอยู่สถานะ `RETURNED` (ถ้าไม่ใช่ได้ `409 INVALID_REVIEW_STATE`)

Request: `{ "note": "แนบเอกสารเพิ่มแล้ว" }` (optional) · Response `200 { "document_id": 660070, "review_state": "PENDING" }`

### GET `/api/me/pending-counts`

ใช้แสดงตัวเลขบนเมนู ทุก role ที่ login เรียกได้ key ที่ role นั้นไม่เกี่ยวข้องให้ส่งเป็น `0` (ห้ามละ key ออก)

```json
{ "inbox_new": 3, "head_pending": 0, "returned": 1 }
```

| Key | นับอะไร |
|---|---|
| `inbox_new` | เอกสารที่ผู้ดูเป็นผู้รับปัจจุบันและ `is_new = true` |
| `head_pending` | (`branch_head`) เอกสาร `review_state = "PENDING"` |
| `returned` | (`document_officer`) เอกสาร `review_state = "RETURNED"` |

### `head_review` object (ใช้ร่วมใน list / detail / head queue)

```json
{ "id": 12, "decision": "DIRECTED", "assignee_id": 2100100, "assignee_name": "อ.ผู้รับ", "note": "...", "reason": null, "head_name": "ผศ.ตัวอย่าง", "created_at": "2026-11-22T03:00:00.000Z" }
```
เป็นแถวล่าสุดของ `document_head_reviews` หรือ `null` ถ้ายังไม่มี ทุก endpoint (list, detail, head queue, response ของ `POST /head-review`) ต้องส่ง object นี้แบบเดียวกันครบทุก key ถ้าไม่มีค่าให้ส่ง `null` ห้ามละ key ออก

| Field | Type | ความหมาย |
|---|---|---|
| `id` | number | id ของแถวใน `document_head_reviews` |
| `decision` | `"DIRECTED"` \| `"RETURNED"` | ผลการพิจารณา |
| `assignee_id` | number \| `null` | ผู้รับที่หัวหน้าสั่งการ (`DIRECTED` มีค่าเสมอ, `RETURNED` เป็น `null`) สารบรรณใช้ค่านี้ตอนแจกจ่าย |
| `assignee_name` | string \| `null` | ชื่อของ `assignee_id` (`full_name` หรือถ้าไม่มีใช้ `username`) สำหรับแสดงผล |
| `note` | string \| `null` | คำสั่งการ |
| `reason` | string \| `null` | เหตุผลการส่งกลับ (`RETURNED` มีค่าเสมอ) |
| `head_name` | string | ชื่อหัวหน้าสาขาที่พิจารณา |
| `created_at` | timestamp | เวลาที่พิจารณา |

---

## #91 เปิดไฟล์ผ่าน S3 Pre-signed URL ✅

| Method | Path | Response |
|---|---|---|
| GET | `/api/documents/:id` | มี `preview_url`, `download_url`, `can_preview`, `display_file_name`, `mime_type` |
| GET | `/api/documents/:id/preview-url` | `{ document_id, file_name, file_size, mime_type, file_extension, can_preview, preview_url, download_url }` |
| GET | `/api/documents/:id/download-url` | `{ document_id, file_name, file_size, mime_type, download_url, expires_in: 300 }` |

- URL ของผู้ที่ login อายุ 300 วินาที ส่วนของ Share Link อายุ 120 วินาที
- `preview_url` เป็น `null` เมื่อไฟล์ preview ไม่ได้ (preview ได้เฉพาะ `.pdf .jpg .jpeg .png`)
- ถ้าสร้าง pre-signed URL ไม่สำเร็จ `preview-url` / `download-url` จะส่ง path สำรองมาแทน (`/api/documents/:id/preview-file`, `/download-file`) ซึ่งต้องส่ง Bearer token ด้วย
- อย่าเก็บ URL ไว้ใช้ทีหลัง ให้ขอใหม่ทุกครั้งที่ผู้ใช้กดเปิด

---

## ประวัติการแก้ไข

| วันที่ | แก้อะไร | Issue/PR |
|---|---|---|
| 2026-11-22 | `head_review` เพิ่ม `id`, `assignee_id`, `assignee_name` ให้รูปแบบเดียวกันทุก endpoint และบังคับให้แจกจ่ายให้ผู้รับที่หัวหน้าสั่งการ (CodeRabbit) | #76 |
| 2026-11-22 | ฉบับแรก: #75 ตามที่ทำแล้วใน PR #98, #77/#79 กำหนดตามชื่อ field ที่ frontend ใช้อยู่ใน `dashboard.js` / `inbox.js`, #91 ตามโค้ดเดิม | #76 |
