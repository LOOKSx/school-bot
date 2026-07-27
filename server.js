const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'bDTV2kMa6U6KqGn1PynuEOs9NKRT6ZUArkvWMoiug/Jt4aICrGUjgMxX+RnXVuzTSQs/RajfSSN5fJtxgnVgt6QeT4x0KhNZm2+j3vMgmKSnnemrJBhL3UagYHpDrQBs6izLGPeBj/pH3BKk5T87xwdB04t89/1O/w1cDnyilFU=';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AQ_YOUR_GEMINI_API_KEY';

const DATA_FILE = path.join(__dirname, 'records.json');

function loadRecords() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return [];
}

function saveRecords(records) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2), 'utf8');
  } catch (e) {}
}

app.get('/', (req, res) => {
  res.send('🟢 LINE Bot Slip Reader is Running Smoothly!');
});

app.get('/webhook', (req, res) => {
  res.send('LINE Bot Webhook Ready');
});

app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');

  try {
    const events = req.body.events;
    if (!events || events.length === 0) return;

    for (const event of events) {
      if (event.type === 'message') {
        if (event.message.type === 'image') {
          await handleImageMessage(event);
        } else if (event.message.type === 'text') {
          await handleTextMessage(event);
        }
      }
    }
  } catch (error) {
    console.error('Error handling webhook:', error.message);
  }
});

async function handleTextMessage(event) {
  if (!event || !event.replyToken || !event.message || !event.message.text) return;

  const userText = event.message.text.trim().toLowerCase();
  const replyToken = event.replyToken;

  const records = loadRecords();

  if (userText.includes('เช็ค') || userText.includes('ping') || userText.includes('ทดสอบ') || userText.includes('status')) {
    const replyText = `🤖 **บอทเปิดทำงานปกติพร้อมสแกนสลิปครับ!**\n` +
                      `----------------------------------\n` +
                      `📊 ยอดผู้โอนเงินสำเร็จแล้ว: ${records.length} รายการ\n` +
                      `💡 วิธีใช้งาน: ส่งภาพสลิปเข้ามาในกลุ่มได้เลยครับ ระบบจะสแกนและเรียงลำดับให้อัตโนมัติ`;
    await replyLineMessage(replyToken, replyText);
  } else if (userText.includes('สรุป') || userText.includes('รายชื่อ')) {
    const summaryList = getPaidSummaryText(records);
    const replyText = `📊 **สรุปรายชื่อผู้โอนเงินทั้งหมดขณะนี้**\n` +
                      `----------------------------------\n` +
                      summaryList;
    await replyLineMessage(replyToken, replyText);
  }
}

async function handleImageMessage(event) {
  if (!event || !event.replyToken) return;

  const replyToken = event.replyToken;
  const messageId = event.message.id;

  const imageBuffer = await getLineImageBuffer(messageId);
  if (!imageBuffer) return;

  const slipInfo = await extractSlipDataWithGemini(imageBuffer);
  if (!slipInfo || !slipInfo.is_slip) return;

  const timestampNow = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  const senderName = slipInfo.sender_name || "ไม่ระบุชื่อผู้โอน";
  const amount = slipInfo.amount || "ไม่ระบุ";
  const slipDateTime = slipInfo.transfer_date_time || timestampNow;

  const records = loadRecords();
  const newOrderNo = records.length + 1;

  records.push({
    orderNo: newOrderNo,
    senderName: senderName,
    amount: amount,
    slipDateTime: slipDateTime,
    timestamp: timestampNow,
    messageId: messageId
  });

  saveRecords(records);

  const summaryList = getPaidSummaryText(records);
  const replyText = `🟢 ได้รับสลิปเรียบร้อยแล้วครับ!\n` +
                    `👤 ผู้โอน: ${senderName}\n` +
                    `💵 จำนวนเงิน: ${amount} บาท\n` +
                    `📅 วันเวลาโอน: ${slipDateTime}\n` +
                    `----------------------------------\n` +
                    `📊 สรุปรายชื่อผู้โอนเงินเรียบร้อย (ลำดับตามสลิป)\n` +
                    summaryList;

  await replyLineMessage(replyToken, replyText);
}

async function getLineImageBuffer(messageId) {
  try {
    const response = await axios.get(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
      headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      responseType: 'arraybuffer'
    });
    return Buffer.from(response.data);
  } catch (e) {
    return null;
  }
}

async function extractSlipDataWithGemini(imageBuffer) {
  const base64Image = imageBuffer.toString('base64');

  const prompt = `ช่วยอ่านรูปภาพนี้ ซึ่งอาจเป็นสลิปโอนเงิน สลิปเติมเงิน สลิปชำระเงิน หรือใบรับเงินธนาคาร
ตอบกลับเป็น JSON ตามโครงสร้างนี้เท่านั้น:
{
  "is_slip": true,
  "sender_name": "ชื่อผู้โอน / ผู้ทำรายการ (อ่านตามที่ปรากฏในสลิป เช่น นาย พุฒิพงศ์ ร...)",
  "amount": "จำนวนเงินตัวเลข เช่น 200 หรือ 500",
  "transfer_date_time": "วัน เดือน ปี และเวลาที่ทำรายการ เช่น 27 ก.ค. 2569 02:32 น."
}
คำเตือน: หากรูปนี้ไม่ใช่สลิปการเงินใดๆ เลย ให้ตอบ {"is_slip": false, "sender_name": null, "amount": null, "transfer_date_time": null}`;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
      ]
    }],
    generationConfig: { response_mime_type: 'application/json' }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const response = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
    let resText = response.data.candidates[0].content.parts[0].text;
    resText = resText.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(resText);
  } catch (e) {
    return null;
  }
}

function getPaidSummaryText(records) {
  if (!records || records.length === 0) return "ยังไม่มีรายชื่อผู้โอน";
  let text = "";
  for (const r of records) {
    text += `${r.orderNo}. ${r.senderName} (${r.amount} บาท) - ${r.slipDateTime}\n`;
  }
  return text;
}

async function replyLineMessage(replyToken, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (e) {}
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Node.js LINE Bot Server running on port ${PORT}`);
});
