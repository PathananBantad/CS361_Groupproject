# คู่มือระบบบันทึกและตรวจสอบประวัติการดำเนินการ (DocuFlow Audit Trail System Documentation)

เอกสารฉบับนี้อธิบายโครงสร้าง สถาปัตยกรรม ประเภท Event และแนวทางการตรวจสอบย้อนหลังของระบบ **Audit Trail** ในระบบ DocuFlow เพื่อให้การดำเนินการเกี่ยวกับเอกสารมีความโปร่งใส ตรวจสอบย้อนหลังได้ (Accountability & Traceability) และป้องกันการแก้ไขหรือลบประวัติโดยไม่ได้รับอนุญาต (Non-repudiation & Immutability)

---

## 1. ภาพรวมและวัตถุประสงค์ (Overview & Goal)

ระบบ **Audit Trail** พัฒนาขึ้นเพื่อบันทึกประวัติเหตุการณ์สำคัญที่เกิดขึ้นกับเอกสารแต่ละฉบับ ตั้งแต่การลงทะเบียนเอกสาร การมอบหมายงาน การส่งต่อเอกสาร จนถึงการเปลี่ยนสถานะตามขั้นตอนการทำงาน (Workflow) 

### หลักการสำคัญ (Key Principles):
1. **ความถูกต้องและน่าเชื่อถือ (Trustworthiness):** ข้อมูลผู้กระทำ (Actor) และวันเวลา (Timestamp) ต้องมาจากฝั่ง Server เท่านั้น ห้ามเชื่อถือค่าที่ส่งมาจาก Client
2. **การคงสภาพและป้องกันการแก้ไข (Immutability & Tamper Protection):** ประวัติที่บันทึกแล้วเป็นแบบ **Append-Only** ห้ามมี API แก้ไข (UPDATE) หรือลบ (DELETE) ประวัติ
3. **ความสอดคล้องของข้อมูล (Transaction Consistency):** ใช้ Database Transaction เพื่อให้มั่นใจว่าเอกสารและประวัติ Audit Trail จะถูกบันทึกสำเร็จพร้อมกันเท่านั้น หากมีข้อผิดพลาดจะถูก Rollback ทั้งหมด
4. **การปกป้องข้อมูลความลับ (Data Sanitization & Secret Scrubbing):** กรองรหัสผ่าน, Access Token, JWT, Session และ API Key ออกจากประวัติการเปลี่ยนแปลงโดยอัตโนมัติ
5. **การควบคุมการเข้าถึงตามสิทธิ์ (Role/Permission Matrix):** จำกัดการเรียกดูประวัติตามบทบาทหน้าที่ของผู้ใช้งาน

---

## 2. ประเภท Event ที่บันทึก (Event Catalog)

ระบบกำหนด Event Type มาตรฐานออกเป็น 4 ประเภทหลัก ดังนี้:

| Event Type | ชื่อภาษาไทย | คำอธิบาย | API ที่เกี่ยวข้อง | สิทธิ์ที่ดำเนินการได้ |
| :--- | :--- | :--- | :--- | :--- |
| `DOCUMENT_CREATE` | การลงทะเบียนเอกสารใหม่ | บันทึกเมื่อมีการสร้างเอกสารเข้าสู่ระบบเป็นครั้งแรก | `POST /api/documents` | เจ้าหน้าที่รับเอกสาร / ผู้ใช้งานที่ได้รับอนุญาต |
| `ASSIGN` | การมอบหมายเอกสาร | บันทึกเมื่อมีการมอบหมายเอกสารให้ผู้รับผิดชอบดำเนินการ | `POST /api/documents/:id/assign` | `document_officer`, `admin` |
| `FORWARD` | การส่งต่อเอกสาร | บันทึกเมื่อมีการส่งต่อเอกสารไปยังบุคคลหรือหน่วยงานอื่น | `POST /api/documents/:id/forward` | `document_officer`, `case_owner`, `admin`, `staff` |
| `STATUS_CHANGE` | การเปลี่ยนสถานะเอกสาร | บันทึกเมื่อมีการเปลี่ยนสถานะตามขั้นตอน Workflow | `PUT /api/documents/:id/status` | `document_officer`, `case_owner`, `admin`, `staff` |

---

## 3. โครงสร้างข้อมูล Audit Trail (Data Architecture)

### 3.1 ตาราง `document_audit_trails` (ตารางหลักสำหรับ Audit Trail)

```sql
CREATE TABLE IF NOT EXISTS document_audit_trails (
    id INT AUTO_INCREMENT PRIMARY KEY COMMENT 'Audit ID อ้างอิงรายการ',
    document_id INT NOT NULL COMMENT 'ID ของเอกสารที่ถูกกระทำ',
    actor_user_id VARCHAR(100) NOT NULL COMMENT 'ID ของผู้ดำเนินการ (ได้จาก Server Session/JWT)',
    actor_username VARCHAR(100) NULL COMMENT 'ชื่อบัญชีของผู้ดำเนินการ',
    actor_role VARCHAR(50) NULL COMMENT 'บทบาทของผู้ดำเนินการ ณ ขณะทำรายการ',
    event_type VARCHAR(50) NOT NULL COMMENT 'ASSIGN, FORWARD, STATUS_CHANGE, DOCUMENT_CREATE',
    before_state JSON NULL COMMENT 'Snapshot ข้อมูลก่อนการเปลี่ยนแปลง',
    after_state JSON NULL COMMENT 'Snapshot ข้อมูลหลังการเปลี่ยนแปลง',
    details JSON NULL COMMENT 'รายละเอียดเพิ่มเติม (หมายเหตุ, เหตุผล, metadata)',
    ip_address VARCHAR(45) NULL COMMENT 'IP Address ของ Client ที่ Server ตรวจพบ',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'วันเวลาที่บันทึก (เวลาของเซิร์ฟเวอร์)',
    INDEX idx_audit_doc (document_id),
    INDEX idx_audit_event (event_type),
    INDEX idx_audit_actor (actor_user_id),
    INDEX idx_audit_time (created_at),
    CONSTRAINT fk_audit_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 3.2 ตารางที่เกี่ยวข้อง

- **`document_assignments`**: จัดเก็บรายละเอียดการมอบหมายและการส่งต่อเอกสาร (document_id, assigned_by_user_id, previous_assignee_id, new_assignee_id, action_type, remarks)
- **`document_status_logs`**: จัดเก็บประวัติสถานะเดิมและสถานะใหม่ (old_status, new_status, changed_by, changed_at) เพื่อรองรับ Backward Compatibility
- **`documents`**: ตารางเอกสารหลักที่มีการเพิ่มฟิลด์ `assignee_id INT NULL` สำหรับผู้รับมอบหมายงานปัจจุบัน

---

## 4. โครงสร้างข้อมูลก่อนและหลังการเปลี่ยนแปลง (Before & After State Design)

เพื่อความโปร่งใสและตรวจสอบย้อนหลังได้ชัดเจน ข้อมูลในคอลัมน์ `before_state` และ `after_state` จะจัดเก็บในรูปแบบ JSON ตามประเภท Event:

### 4.1 การเปลี่ยนสถานะเอกสาร (`STATUS_CHANGE`)
```json
// Before State
{
  "status": "Received"
}

// After State
{
  "status": "Assigned"
}

// Details
{
  "remarks": "มอบหมายให้ฝ่ายวิชาการดำเนินการตรวจสอบ",
  "old_status_label": "ได้รับเอกสารแล้ว",
  "new_status_label": "มอบหมายแล้ว",
  "is_admin_override": false
}
```

### 4.2 การมอบหมายเอกสาร (`ASSIGN`)
```json
// Before State
{
  "owner_id": null,
  "assignee_id": null,
  "status": "Received"
}

// After State
{
  "owner_id": 1,
  "assignee_id": 1,
  "status": "Assigned"
}

// Details
{
  "assignee_name": "staff01",
  "previous_assignee_id": null,
  "new_assignee_id": "1",
  "remarks": "มอบหมายงานตรวจสอบคำร้อง"
}
```

### 4.3 การส่งต่อเอกสาร (`FORWARD`)
```json
// Before State
{
  "owner_id": 1,
  "assignee_id": 1,
  "receiver_name": null,
  "status": "Assigned"
}

// After State
{
  "owner_id": 1,
  "assignee_id": 2,
  "receiver_name": "ฝ่ายวิชาการและวิจัย",
  "status": "Assigned"
}

// Details
{
  "new_assignee_name": "admin01",
  "previous_assignee_id": "1",
  "new_assignee_id": "2",
  "receiver_name": "ฝ่ายวิชาการและวิจัย",
  "reason": "ส่งต่อเพื่อพิจารณาเพิ่มเติมตามระเบียบ",
  "remarks": "ส่งต่อตามขั้นตอน"
}
```

### 4.4 การลงทะเบียนเอกสารใหม่ (`DOCUMENT_CREATE`)
```json
// Before State
null

// After State
{
  "reference_no": "DOC-20261018-0001",
  "document_number": "ว 102/2569",
  "subject": "ขออนุมัติจัดโครงการสัมมนาเชิงปฏิบัติการ",
  "document_type": "เอกสารขออนุมัติ",
  "sender_name": "สาขาวิทยาการคอมพิวเตอร์",
  "receiving_channel": "EMAIL",
  "status": "Received"
}

// Details
{
  "remarks": "รับเอกสารผ่านระบบอีเมลกลาง"
}
```

---

## 5. กลไกความมั่นคงปลอดภัยและความถูกต้อง (Security & Integrity Controls)

### 5.1 การดึงข้อมูลผู้ดำเนินการและวันเวลาจาก Server (Server-Derived Actor & Timestamp)
- ข้อมูลผู้ดำเนินการถูกดึงผ่าน `extractServerActor(req)`:
  - ดึงจาก Cookie Session ที่เข้ารหัส (`req.session.user`) หรือ
  - ดึงจาก AWS Cognito JWT Access Token ที่ผ่านการ Verify ลายเซ็นดิจิทัล (`req.auth.sub`, `req.auth.username`, `req.userRole`)
  - IP Address ดึงจาก Header `x-forwarded-for` หรือ `req.socket.remoteAddress`
- **ระบบจะเพิกเฉย (Ignore) ต่อค่า `actor_id`, `user_id`, หรือ `timestamp` ใดๆ ที่ Client ส่งมาใน Request Body** ป้องกันการสวมรอย 100%

### 5.2 การจัดการข้อผิดพลาดด้วย Database Transaction (ACID Consistency)
- ทุก API ที่ทำการเปลี่ยนแปลงเอกสารและบันทึกประวัติ จะทำงานภายใต้ Database Transaction เดียวกัน:
  1. `await connection.beginTransaction()`
  2. ดึงข้อมูลสถานะเดิมพร้อม Lock แถว (`SELECT ... FOR UPDATE`)
  3. ตรวจสอบเงื่อนไขความถูกต้อง
  4. อัปเดตข้อมูลตาราง `documents`
  5. บันทึกข้อมูลลงใน `document_assignments` หรือ `document_status_logs`
  6. บันทึก Audit Event ผ่าน `recordAuditEvent(...)`
  7. `await connection.commit()`
- หากเกิดข้อผิดพลาดในขั้นตอนใดขั้นตอนหนึ่ง ระบบจะสั่ง `await connection.rollback()` ทันที ทำให้ไม่มีประวัติหลงเหลือหรือเอกสารเปลี่ยนแปลงโดยไม่มีประวัติ

### 5.3 การป้องกันการแก้ไขหรือลบประวัติ (Immutability & Tamper Protection)
- ไม่มี Endpoint สำหรับแก้ไข (`PUT`, `PATCH`) หรือลบ (`DELETE`) ประวัติ Audit Trail
- ระบบกำหนด Route Guard ปฏิเสธคำขอ `PUT/DELETE` ไปยัง Endpoint ของ Audit Trail ด้วยรหัส `405 Method Not Allowed`
- Service Layer มีเฉพาะฟังก์ชัน `recordAuditEvent` (Create) และ `getAuditTrail...` (Read) โดยไม่มีฟังก์ชัน Update/Delete ในโค้ด

### 5.4 การทำความสะอาดข้อมูลลับและข้อมูลส่วนบุคคล (Data Sanitization)
ฟังก์ชัน `sanitizeAuditData()` ทำการตรวจสอบข้อมูล JSON แบบ Recursive และกรองข้อมูลลับออกก่อนจัดเก็บ:
- ฟิลด์ที่ตรงกับ Blacklist จะถูกแปลงเป็น `"[REDACTED]"`:
  `password`, `password_hash`, `token`, `access_token`, `refresh_token`, `authorization`, `api_key`, `secret`, `credential`, `cookie`, `session`
- สแกนข้อความใน String เพื่อดักจับ Pattern:
  - JSON Web Tokens (JWT) -> แปลงเป็น `"[REDACTED_JWT]"`
  - Bearer Tokens -> แปลงเป็น `"[REDACTED_BEARER_TOKEN]"`
  - AWS Access Keys / GitHub Personal Access Tokens -> แปลงเป็น `"[REDACTED_KEY]"`

---

## 6. เมทริกซ์สิทธิ์การเข้าถึงประวัติ (Role & Permission Matrix)

| บทบาท (Role) | คำอธิบาย | ดู Audit Trail เอกสารฉบับที่เกี่ยวข้อง | ดู Audit Trail เอกสารฉบับอื่น | ดู Audit Trail รวมทั้งระบบ (`/api/audit-trails`) |
| :--- | :--- | :---: | :---: | :---: |
| `admin` | ผู้ดูแลระบบ | ✅ อนุญาต | ✅ อนุญาต | ✅ อนุญาต |
| `executive` | ผู้บริหาร | ✅ อนุญาต | ✅ อนุญาต | ✅ อนุญาต |
| `document_officer` | เจ้าหน้าที่รับเอกสาร | ✅ อนุญาต | ✅ อนุญาต (เอกสารทั่วไป) | ❌ ไม่อนุญาต (403) |
| `case_owner` | ผู้รับผิดชอบเรื่อง | ✅ อนุญาต (เฉพาะที่ตนเป็นเจ้าของ) | ❌ ไม่อนุญาต (403) | ❌ ไม่อนุญาต (403) |
| `faculty_staff` / `staff` | อาจารย์ / เจ้าหน้าที่ | ✅ อนุญาต (เฉพาะที่ได้รับมอบหมาย) | ❌ ไม่อนุญาต (403) | ❌ ไม่อนุญาต (403) |
| `guest` | ผู้ใช้ทั่วไป / บุคคลภายนอก | ❌ ไม่อนุญาต (403) | ❌ ไม่อนุญาต (403) | ❌ ไม่อนุญาต (403) |

---

## 7. ข้อกำหนดทางเทคนิคของ API (API Specification)

### 7.1 ดึงประวัติ Audit Trail ของเอกสาร
- **Method:** `GET`
- **URL:** `/api/documents/:id/audit-trail`
- **Headers:** `Authorization: Bearer <token>` หรือ Cookie Session
- **Query Parameters (ทางเลือก):**
  - `event_type`: กรองเฉพาะประเภท Event เช่น `STATUS_CHANGE`, `ASSIGN`, `FORWARD`, `DOCUMENT_CREATE`
  - `from_date`: กรองตั้งแต่วันที่ (YYYY-MM-DD)
  - `to_date`: กรองถึงวันที่ (YYYY-MM-DD)
- **Response Example (200 OK):**
```json
{
  "ok": true,
  "document_id": "12",
  "reference_no": "DOC-20261018-0001",
  "subject": "ขออนุมัติจัดโครงการสัมมนาเชิงปฏิบัติการ",
  "current_status": "Processing",
  "total": 3,
  "history": [
    {
      "audit_id": 101,
      "document_id": 12,
      "actor_user_id": "staff01",
      "actor_username": "staff01",
      "actor_role": "document_officer",
      "event_type": "DOCUMENT_CREATE",
      "event_metadata": {
        "label_th": "การลงทะเบียนเอกสารใหม่",
        "label_en": "Document Creation",
        "icon": "📄",
        "color": "green"
      },
      "before_state": null,
      "after_state": {
        "reference_no": "DOC-20261018-0001",
        "subject": "ขออนุมัติจัดโครงการสัมมนาเชิงปฏิบัติการ",
        "status": "Received"
      },
      "details": {
        "remarks": "รับเอกสารผ่านระบบอีเมล"
      },
      "ip_address": "192.168.1.50",
      "timestamp": "2026-10-18T10:00:00.000Z"
    },
    {
      "audit_id": 102,
      "document_id": 12,
      "actor_user_id": "staff01",
      "actor_username": "staff01",
      "actor_role": "staff",
      "event_type": "ASSIGN",
      "event_metadata": {
        "label_th": "การมอบหมายเอกสาร",
        "label_en": "Document Assignment",
        "icon": "👤",
        "color": "blue"
      },
      "before_state": {
        "owner_id": null,
        "assignee_id": null,
        "status": "Received"
      },
      "after_state": {
        "owner_id": 1,
        "assignee_id": 1,
        "status": "Assigned"
      },
      "details": {
        "assignee_name": "staff01",
        "previous_assignee_id": null,
        "new_assignee_id": "1",
        "remarks": "มอบหมายให้เจ้าหน้าที่ดำเนินการ"
      },
      "ip_address": "192.168.1.50",
      "timestamp": "2026-10-18T10:05:00.000Z"
    }
  ]
}
```

### 7.2 ดึงรายการ Audit Trail ทั้งระบบ (สำหรับ Admin / Executive)
- **Method:** `GET`
- **URL:** `/api/audit-trails`
- **Query Parameters:**
  - `page`: หน้าที่ต้องการ (default: 1)
  - `limit`: จำนวนรายการต่อหน้า (default: 20, max: 100)
  - `document_id`: กรองเฉพาะเอกสาร ID
  - `event_type`: กรองเฉพาะประเภท Event
  - `actor_id`: กรองเฉพาะผู้ดำเนินการ
  - `from_date`, `to_date`: ช่วงวันที่
- **Response Example (200 OK):**
```json
{
  "ok": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "totalPages": 8
  }
}
```

### 7.3 มอบหมายเอกสาร (`POST /api/documents/:id/assign`)
- **Method:** `POST`
- **สิทธิ์:** `document_officer` หรือ `admin`; Server ตรวจ Role และสิทธิ์เข้าถึงเอกสารก่อนบันทึก
- **ผู้รับ:** ต้องเป็นบัญชีที่ใช้งานได้และมี Role `case_owner` หรือ `faculty_staff`; การมอบหมายไม่เปลี่ยน `owner_id` หรือเพิ่มสิทธิ์เข้าถึงเอกสาร
- **Body:**
```json
{
  "assignee_id": "1",
  "remarks": "มอบหมายให้ตรวจสอบเอกสาร"
}
```
- ผู้มอบหมายและ Role มาจากข้อมูลผู้ใช้ที่ Server ยืนยันแล้ว ไม่รับจาก Request Body

### 7.4 ส่งต่อเอกสาร (`POST /api/documents/:id/forward`)
- **Method:** `POST`
- **Body:**
```json
{
  "new_assignee_id": "2",
  "new_assignee_name": "อาจารย์ สมศรี",
  "receiver_name": "ฝ่ายวิจัยและนวัตกรรม",
  "reason": "เสนอพิจารณางบประมาณวิจัย",
  "remarks": "ส่งต่อตามระเบียบวาระ"
}
```

---

## 8. แนวทางการตรวจสอบประวัติย้อนหลัง (Auditing Guidelines)

### 8.1 เมื่อเกิดข้อพิพาทหรือต้องการตรวจสอบการแก้ไขเอกสาร
1. **ค้นหาด้วย Reference No หรือ Document ID:**
   ใช้คำสั่ง SQL หรือ API:
   ```sql
   SELECT a.id, a.event_type, a.actor_user_id, a.actor_username, a.actor_role,
          a.before_state, a.after_state, a.details, a.ip_address, a.created_at
   FROM document_audit_trails a
   WHERE a.document_id = 12
   ORDER BY a.created_at ASC, a.id ASC;
   ```
2. **วิเคราะห์ลำดับเหตุการณ์ (Chronological Timeline):**
   - ตรวจสอบว่าใครเป็นผู้สร้างเอกสาร (`DOCUMENT_CREATE`)
   - ตรวจสอบว่ามีการมอบหมายให้ใคร และใครเป็นผู้มอบหมาย (`ASSIGN`)
   - ตรวจสอบว่ามีการส่งต่อเอกสารไปที่ใด และด้วยเหตุผลใด (`FORWARD`)
   - ตรวจสอบลำดับการเปลี่ยนสถานะ ว่าข้ามขั้นตอนหรือไม่ หรือมีผู้ดูแลระบบแก้ไขหรือไม่ (`STATUS_CHANGE`)
3. **ตรวจสอบความถูกต้องของผู้กระทำ (Actor Verification):**
   - เปรียบเทียบ `actor_user_id` กับบันทึกในตาราง `users`
   - ตรวจสอบ `ip_address` เพื่อยืนยันว่ากระทำจากเครือข่ายภายในหรือภายนอกหน่วยงาน
4. **ตรวจสอบความสมบูรณ์ของประวัติ (Integrity Check):**
   - ค่า `created_at` ของแต่ละ Event ต้องเรียงลำดับตามเวลาจริงเสมอ
   - ค่า `before_state` ของ Event ปัจจุบัน ต้องสอดคล้องกับ `after_state` ของ Event ก่อนหน้าเสมอ

---

## 9. ผลการทดสอบและรับรองความถูกต้อง (Verification & Test Results)

ระบบได้รับการทดสอบความถูกต้องผ่าน Automated Test Suite ครบถ้วน 100%:
- **`backend/test_workflow_v3.js`**: ผ่านการทดสอบเงื่อนไข Workflow V3 ครบทุกกรณี
- **`backend/test_audit_trail.js`**: ผ่านการทดสอบครอบคลุม 9 ด้าน:
  1. Unit Test Data Sanitizer (ล้าง Password, Token, JWT, API Key)
  2. Document Creation Audit Logging
  3. Server-side Actor & Timestamp Anti-Spoofing
  4. Document Forwarding with Before & After State
  5. Status Change State Transition Tracking
  6. Role/Permission Matrix (Admin vs Guest)
  7. Global Audit Trail Query & Authorization
  8. Immutability & Tamper Protection (HTTP 405)
  9. Transaction Consistency & Rollback on Failure
