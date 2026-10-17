const db = require('./db');

const verifyRole = (allowedRoles) => {
  return (req, res, next) => {

    const user = req.user;

    if (!user || !user.role) {
      return res.status(403).json({ error: "Access denied: ไม่พบข้อมูลสิทธิ์การใช้งาน" });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access denied: คุณไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้" });
    }

    next();
  };
};

// ตรวจสอบว่าผู้ใช้มีสิทธิ์เข้าถึงเอกสารฉบับนี้(ป้องกันการเปลี่ยน ID)
const verifyDocumentAccess = async (req, res, next) => {
  try {
    const documentId = req.params.id || req.body.document_id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // ถ้าเป็น Admin หรือ Staff ระดับสูง อาจจะให้ผ่านได้เลย
    if (userRole === 'ADMIN' || userRole === 'STAFF') {
      return next();
    }

    // ดึงข้อมูลเอกสารจากฐานข้อมูล MySQL เพื่อเช็กเจ้าของหรือผู้รับผิดชอบ
    const [rows] = await db.query(
      'SELECT * FROM documents WHERE id = ?', 
      [documentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "ไม่พบเอกสารที่คุณต้องการเข้าถึง" });
    }

    const document = rows[0];

    // ตรวจสอบว่าผู้ใช้เป็นเจ้าของ
    if (document.owner_id !== userId && document.assignee_id !== userId) {
      return res.status(403).json({ error: "Access denied: คุณไม่มีสิทธิ์เข้าถึงเอกสารฉบับนี้" });
    }

    // เก็บข้อมูลเอกสารไว้ใน req เพื่อเอาไปใช้ต่อใน Route ได้เลยไม่ต้อง query ซ้ำ
    req.document = document;
    next();
  } catch (error) {
    console.error("Error verifying document access:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.puzzles = {
  verifyRole,
  verifyDocumentAccess
};