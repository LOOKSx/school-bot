# คู่มือการติดตั้ง LINE Bot สแกนสลิป + สรุปรายชื่อผู้ปกครอง (Google Apps Script)

## 📌 สิ่งที่ต้องเตรียม
1. บัญชี Google (สำหรับ Google Sheets + Google Apps Script + Gemini API)
2. บัญชี LINE Developers (สำหรับสร้าง LINE Bot)

---

## 🛠️ ขั้นตอนที่ 1: สมัครและตั้งค่า LINE Bot

1. เข้าเว็บ [LINE Developers Console](https://developers.line.biz/) แล้วเข้าสู่ระบบด้วยบัญชี LINE
2. กด **Create a new Provider** (ตั้งชื่ออะไรก็ได้ เช่น `School-Bot`)
3. เลือก **Create a Messaging API channel**:
   - **Channel name**: ตั้งชื่อ Bot (เช่น `บอทเช็คยอดโอน`)
   - **Channel description**: รายละเอียดบอท
   - **Category**: เลือกหมวดหมู่ตามต้องการ
4. เมื่อสร้างเสร็จแล้ว ไปที่แท็บ **Messaging API**:
   - เลื่อนลงมาล่างสุดที่ **Channel access token (long-lived)** กด **Issue** แล้วคัดลอกรหัส Token ยาวๆ เก็บไว้
   - หาหัวข้อ **Allow bot to join group chats** กดแก้ไขเป็น **Enabled** (เพื่อให้บอทเข้ากลุ่มได้)

---

## 🛠️ ขั้นตอนที่ 2: ขอ Gemini API Key (สำหรับสแกนสลิป ฟรี)

1. เข้าเว็บ [Google AI Studio](https://aistudio.google.com/)
2. เข้าสู่ระบบด้วย Gmail แล้วกด **Get API key**
3. กด **Create API key**
4. คัดลอก **API Key** เก็บไว้

---

## 🛠️ ขั้นตอนที่ 3: สร้าง Google Sheets

1. เข้าไปที่ [Google Sheets](https://sheets.google.com/) แล้วสร้างชีตใหม่
2. เปลี่ยนชื่อแผ่นงาน (Tab ด้านล่าง) เป็น: `รายการโอนเงิน`
3. สังเกตที่ URL ด้านบน จะมีไอดีของ Sheet เช่น:
   `https://docs.google.com/spreadsheets/d/`**1aBcDeFgHiJkLmNoPqRsTuVwXyZ**`/edit`
   ให้คัดลอกรหัสตรงกลางที่เป็นตัวหนาเอาไว้ (นี่คือ **Spreadsheet ID**)

---

## 🛠️ ขั้นตอนที่ 4: ใส่โค้ดใน Google Apps Script & Deploy

1. ในหน้า Google Sheet ให้คลิกเมนู **ส่วนขยาย (Extensions)** ➔ **Apps Script**
2. ลบโค้ดเดิมออกทั้งหมด แล้วคัดลอกโค้ดจากไฟล์ `Code.gs` ไปวาง
3. นำค่าที่คัดลอกมาจากขั้นตอน 1, 2, 3 มาวางแทนที่ตัวแปรในโค้ดบรรทัดบนสุด:
   ```javascript
   const LINE_CHANNEL_ACCESS_TOKEN = 'วาง_Token_จาก_LINE';
   const GEMINI_API_KEY = 'วาง_API_Key_จาก_Gemini';
   const SPREADSHEET_ID = 'วาง_ID_จาก_Google_Sheet';
   ```
4. กดบันทึก (รูปแผ่นดิสก์ 💾 หรือกด `Ctrl + S`)
5. กดปุ่ม **การทำให้ใช้งานได้ (Deploy)** มุมขวาบน ➔ **การทำให้ใช้งานได้ใหม่ (New deployment)**
6. คลิกไอคอนรูปเฟือง ⚙️ เลือก **เว็บแอป (Web app)**
   - **คำอธิบาย (Description)**: LINE Slip Bot
   - **ผู้มีสิทธิ์เข้าถึง (Who has access)**: เปลี่ยนเป็น **ทุกคน (Anyone)** *(สำคัญมาก!)*
7. กด **ทำให้ใช้งานได้ (Deploy)**
8. กดยืนยันสิทธิ์ (Authorize Access) ➔ เลือกอีเมลของคุณ ➔ กด Advanced ➔ กด Go to ... (unsafe) ➔ กด Allow
9. คัดลอก **URL ของเว็บแอป (Web app URL)** ที่ได้มา (ขึ้นต้นด้วย `https://script.google.com/macros/s/...`)

---

## 🛠️ ขั้นตอนที่ 5: เชื่อมต่อ Webhook URL กับ LINE Bot

1. กลับไปที่หน้า [LINE Developers Console](https://developers.line.biz/) แท็บ **Messaging API**
2. หาหัวข้อ **Webhook URL** กด **Edit**
3. วาง **URL ของเว็บแอป** ที่คัดลอกมาจากขั้นตอนที่ 4 แล้วกด **Save**
4. เปิดสวิตช์ **Use webhook** ให้เป็น **ON** (สีเขียว)
5. (แนะนำเพิ่มเติม) ไปที่แท็บ **LINE Official Account features** ➔ กด Edit ที่ **Auto-reply messages** ➔ ปิด Auto-reply เพื่อไม่ให้บอทพื้นฐานตอบซ้ำซ้อน

---

## 🎉 พร้อมใช้งานแล้ว!
1. ดึง LINE Bot เข้ากลุ่ม LINE ของผู้ปกครอง
2. เมื่อผู้ปกครองส่งภาพสลิปเข้ามา บอทจะสแกนอ่านชื่อผู้โอนอัตโนมัติ 
3. บอทจะบันทึกข้อมูลลง Google Sheet และตอบกลับสรุปรายชื่อผู้โอนเรียบร้อย ลำดับ 1, 2, 3... ให้ทันทีในกลุ่ม!
