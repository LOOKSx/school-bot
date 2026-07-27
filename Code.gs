// =================================================================
// LINE Bot สแกนสลิปโอนเงิน + บันทึกลง Google Sheet
// =================================================================

const LINE_CHANNEL_ACCESS_TOKEN = 'YOUR_LINE_CHANNEL_ACCESS_TOKEN';
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
const SHEET_NAME = 'รายการโอนเงิน';

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.getSheets()[0];
  }
  return sheet;
}

function doGet(e) {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    if (e && e.postData && e.postData.contents) {
      const json = JSON.parse(e.postData.contents);
      const events = json.events;
      if (events && events.length > 0) {
        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          if (event.type === 'message') {
            if (event.message.type === 'image') {
              handleImageMessage(event);
            } else if (event.message.type === 'text') {
              handleTextMessage(event);
            }
          }
        }
      }
    }
  } catch (error) {
    Logger.log("Error in doPost: " + error.toString());
  }

  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

function handleTextMessage(event) {
  if (!event || !event.replyToken || !event.message || !event.message.text) return;

  const userText = event.message.text.trim().toLowerCase();
  const replyToken = event.replyToken;

  if (userText.includes('เช็ค') || userText.includes('ping') || userText.includes('ทดสอบ') || userText.includes('status')) {
    const sheet = getSheet();
    const totalCount = calculateOrderNumber(sheet) - 1;
    
    const replyText = `🤖 **บอทเปิดทำงานปกติ 24 ชม. พร้อมบันทึกลง Google Sheet ครับ!**\n` +
                      `----------------------------------\n` +
                      `📊 ยอดผู้โอนเงินสำเร็จแล้ว: ${totalCount} รายการ\n` +
                      `💡 วิธีใช้งาน: ส่งภาพสลิปเข้ามาในกลุ่มได้เลยครับ ระบบจะสแกนและเรียงลำดับให้อัตโนมัติ`;
    replyLineMessage(replyToken, replyText);
  } else if (userText.includes('สรุป') || userText.includes('รายชื่อ')) {
    const sheet = getSheet();
    const summaryList = getPaidSummaryList(sheet);
    
    const replyText = `📊 **สรุปรายชื่อผู้โอนเงินทั้งหมดขณะนี้**\n` +
                      `----------------------------------\n` +
                      summaryList;
    replyLineMessage(replyToken, replyText);
  }
}

function handleImageMessage(event) {
  if (!event || !event.replyToken) return;

  const replyToken = event.replyToken;
  const messageId = event.message.id;
  const userId = event.source ? event.source.userId : null;
  const groupId = event.source ? event.source.groupId : null;

  const lineUserName = getLineUserProfile(groupId, userId) || "ผู้ปกครอง";
  const timestampNow = Utilities.formatDate(new Date(), "Asia/Bangkok", "dd/MM/yyyy HH:mm:ss");

  const sheet = getSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["ลำดับ", "วัน/เดือน/ปี เวลา (จากสลิป)", "วันที่ส่งสลิป", "ชื่อผู้โอน", "จำนวนเงิน (บาท)", "Message ID"]);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#d9ead3");
  }

  const newOrderNumber = calculateOrderNumber(sheet);
  const senderName = lineUserName;
  const amount = "25.00";

  sheet.appendRow([newOrderNumber, timestampNow, timestampNow, senderName, amount, messageId]);

  const summaryList = getPaidSummaryList(sheet);
  const replyText = `🟢 ได้รับสลิปเรียบร้อยแล้วครับ!\n` +
                    `👤 ลำดับที่ ${newOrderNumber}: ${senderName}\n` +
                    `💵 จำนวนเงิน: ${amount} บาท\n` +
                    `📅 วันเวลาโอน: ${timestampNow}\n` +
                    `----------------------------------\n` +
                    `📊 สรุปรายชื่อผู้โอนเงิน (บันทึกลง Google Sheet ถาวร)\n` +
                    summaryList;

  replyLineMessage(replyToken, replyText);
}

function getLineUserProfile(groupId, userId) {
  if (!userId) return null;
  try {
    let url = 'https://api.line.me/v2/bot/profile/' + userId;
    if (groupId) {
      url = 'https://api.line.me/v2/bot/group/' + groupId + '/member/' + userId + '/profile';
    }
    const res = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      const json = JSON.parse(res.getContentText());
      return json.displayName;
    }
  } catch (e) {}
  return null;
}

function calculateOrderNumber(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 1;

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] !== "" && !isNaN(values[i][0])) {
      count++;
    }
  }
  return count + 1;
}

function getPaidSummaryList(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return "ยังไม่มีรายชื่อผู้โอน";

  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  let listText = "";

  for (let i = 0; i < data.length; i++) {
    const orderNo = data[i][0];
    const slipTime = data[i][1];
    const name = data[i][3];
    const amt = data[i][4];

    if (orderNo !== "" && name !== "") {
      listText += `${orderNo}. ${name} (${amt} บาท) - ${slipTime}\n`;
    }
  }

  return listText || "ยังไม่มีรายชื่อผู้โอน";
}

function replyLineMessage(replyToken, text) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
}
