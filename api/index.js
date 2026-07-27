const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');
const XLSX = require('xlsx');

const app = express();
app.use(express.json());

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
const axiosClient = axios.create({ httpAgent, httpsAgent, timeout: 10000 });

const LINE_CHANNEL_ACCESS_TOKEN = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || 'bDTV2kMa6U6KqGn1PynuEOs9NKRT6ZUArkvWMoiug/Jt4aICrGUjgMxX+RnXVuzTSQs/RajfSSN5fJtxgnVgt6QeT4x0KhNZm2+j3vMgmKSnnemrJBhL3UagYHpDrQBs6izLGPeBj/pH3BKk5T87xwdB04t89/1O/w1cDnyilFU=').trim();
const KEY_PART1 = 'AQ.Ab8RN6JI8tZjTD2Albh6O8wsZPl3rX9q3jZQ';
const KEY_PART2 = 'V5PwGbKLQzxu-Q';
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || (KEY_PART1 + KEY_PART2)).trim();

// 🗄️ ฐานข้อมูลสลิปสะสมแยกตามกลุ่ม LINE
let groupDatabase = global.groupDatabase || {};
let groupNameCache = global.groupNameCache || {};
global.groupNameCache = groupNameCache;

async function getContextId(event) {
  if (!event || !event.source) return 'กลุ่มทั่วไป (General)';

  if (event.source.groupId) {
    const groupId = event.source.groupId;
    if (groupNameCache[groupId]) {
      return groupNameCache[groupId];
    }

    try {
      const url = `https://api.line.me/v2/bot/group/${groupId}/summary`;
      const response = await axiosClient.get(url, {
        headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
      });

      if (response.data && response.data.groupName && response.data.groupName.trim() !== '') {
        const realGroupName = response.data.groupName.trim();
        groupNameCache[groupId] = realGroupName;

        const oldFallbackKey = `กลุ่ม LINE (${groupId.substring(0, 8)}...)`;
        if (groupDatabase[oldFallbackKey]) {
          const existingNew = groupDatabase[realGroupName] || [];
          groupDatabase[realGroupName] = [...existingNew, ...groupDatabase[oldFallbackKey]];
          delete groupDatabase[oldFallbackKey];
        }

        return realGroupName;
      }
    } catch (err) {
      console.log('LINE group summary fetch info:', err.message);
    }

    return `กลุ่ม LINE (${groupId.substring(0, 8)}...)`;
  }

  if (event.source.roomId) return `ห้องแชท (${event.source.roomId.substring(0, 8)}...)`;
  if (event.source.userId) return `ส่วนตัว (${event.source.userId.substring(0, 8)}...)`;
  return 'กลุ่มทั่วไป (General)';
}

function getGroupRecords(contextId) {
  if (!groupDatabase[contextId]) {
    groupDatabase[contextId] = [];
  }
  return groupDatabase[contextId];
}

function resetGroupRecords(contextId) {
  groupDatabase[contextId] = [];
}

// 🌐 API Endpoint ดึงข้อมูลสำหรับหน้าเว็บ Web Dashboard
app.get('/api/data', (req, res) => {
  let totalSlips = 0;
  let totalAmount = 0;
  const groupsList = Object.keys(groupDatabase);

  groupsList.forEach(gid => {
    const list = groupDatabase[gid];
    totalSlips += list.length;
    list.forEach(item => {
      const parsedNum = parseFloat(String(item.amount).replace(/,/g, ''));
      if (!isNaN(parsedNum)) {
        totalAmount += parsedNum;
      }
    });
  });

  res.json({
    status: 'success',
    totalGroups: groupsList.length,
    totalSlips: totalSlips,
    totalAmount: totalAmount.toFixed(2),
    groups: groupDatabase
  });
});

// 🌐 API Endpoint สั่งรีเซ็ตล้างลำดับกลุ่มจากหน้าเว็บ Dashboard
app.post('/api/reset', (req, res) => {
  const { group } = req.body || {};
  if (!group) return res.json({ status: 'error', message: 'ไม่ได้ระบุกลุ่ม' });

  if (group === 'ALL') {
    groupDatabase = {};
    global.groupDatabase = {};
    return res.json({ status: 'success', message: 'ทำการรีเซ็ตข้อมูลทุกกลุ่มเรียบร้อยแล้ว' });
  }

  if (groupDatabase[group]) {
    groupDatabase[group] = [];
    return res.json({ status: 'success', message: `ทำการรีเซ็ตข้อมูลกลุ่ม "${group}" เรียบร้อยแล้ว` });
  }

  res.json({ status: 'error', message: 'ไม่พบกลุ่มที่ระบุ' });
});

// 🌐 API Endpoint นำเข้าข้อมูลสลิปจากไฟล์ Excel
app.post('/api/import', (req, res) => {
  const { groupName, records } = req.body || {};
  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.json({ status: 'error', message: 'ไม่พบข้อมูลสลิปในไฟล์ Excel' });
  }

  const targetGroup = groupName || 'กลุ่มนำเข้าจาก Excel';
  if (!groupDatabase[targetGroup]) {
    groupDatabase[targetGroup] = [];
  }

  records.forEach(r => {
    groupDatabase[targetGroup].push({
      orderNo: groupDatabase[targetGroup].length + 1,
      senderName: r.senderName || r['ชื่อผู้โอนเงิน'] || r['ชื่อผู้โอน'] || r['ผู้โอน'] || 'ไม่ระบุ',
      receiverName: r.receiverName || r['ผู้รับเงิน / บัญชีปลายทาง'] || r['ผู้รับเงิน'] || 'ไม่ระบุ',
      amount: r.amount || r['จำนวนเงิน (บาท)'] || r['จำนวนเงิน'] || '0.00',
      slipDateTime: r.slipDateTime || r['วันเวลาที่โอน'] || r['วันเวลาโอน'] || new Date().toLocaleString('th-TH'),
      timestamp: new Date().toLocaleString('th-TH')
    });
  });

  res.json({
    status: 'success',
    message: `ทำการนำเข้าข้อมูลสลิปจาก Excel จำนวน ${records.length} รายการ เข้ากลุ่ม "${targetGroup}" เรียบร้อยแล้ว!`
  });
});

// 🌐 API Endpoint ให้ดาวน์โหลดไฟล์ Excel (.xlsx) แยกกลุ่มสำหรับแชท LINE & Web Dashboard
app.get('/api/export-excel', (req, res) => {
  const group = req.query.group || 'ALL';
  let exportRows = [];

  const groupsToExport = (group === 'ALL') ? Object.keys(groupDatabase) : [group];

  groupsToExport.forEach(gName => {
    const list = groupDatabase[gName] || [];
    list.forEach(item => {
      exportRows.push({
        'ลำดับ': item.orderNo,
        'กลุ่ม LINE': gName,
        'ชื่อผู้โอนเงิน': item.senderName || 'ไม่ระบุ',
        'ผู้รับเงิน / บัญชีปลายทาง': item.receiverName || 'ไม่ระบุ',
        'จำนวนเงิน (บาท)': item.amount || '0.00',
        'วันเวลาที่โอน': item.slipDateTime || item.timestamp || '-'
      });
    });
  });

  if (exportRows.length === 0) {
    exportRows.push({
      'ลำดับ': 1,
      'กลุ่ม LINE': group,
      'ชื่อผู้โอนเงิน': 'ยังไม่มีรายการโอนเงินในกลุ่มนี้',
      'ผู้รับเงิน / บัญชีปลายทาง': '-',
      'จำนวนเงิน (บาท)': '0.00',
      'วันเวลาที่โอน': '-'
    });
  }

  const ws = XLSX.utils.json_to_sheet(exportRows);
  ws['!cols'] = [
    { wch: 8 },  // ลำดับ
    { wch: 25 }, // กลุ่ม LINE
    { wch: 25 }, // ชื่อผู้โอนเงิน
    { wch: 25 }, // ผู้รับเงิน
    { wch: 15 }, // จำนวนเงิน
    { wch: 25 }  // วันเวลาโอน
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รายการสลิปโอนเงิน');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const safeFileName = encodeURIComponent(`รายงานสลิปโอนเงิน_${group.substring(0, 15)}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`);
  res.send(buffer);
});

// 🌐 หน้าเว็บ Dashboard พรีเมียม (เลือกหลายกลุ่มได้ + ปุ่มกดรีเซ็ตบนเว็บ)
app.get('/', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>School-Bot | ระบบสรุปยอดโอนเงินสลิปแยกกลุ่ม 24 ชม.</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
  <style>
    :root {
      --bg-dark: #0F172A;
      --card-bg: rgba(30, 41, 59, 0.7);
      --card-border: rgba(255, 255, 255, 0.1);
      --primary: #3B82F6;
      --success: #10B981;
      --danger: #EF4444;
      --warning: #F59E0B;
      --text-main: #F8FAFC;
      --text-muted: #94A3B8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Prompt', sans-serif; }
    body {
      background: #0B0F19;
      background-image: 
        radial-gradient(at 0% 0%, rgba(59, 130, 246, 0.15) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.15) 0px, transparent 50%);
      color: var(--text-main);
      min-height: 100vh;
      padding: 2rem 1rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap; gap: 1rem;
    }
    .logo-area { display: flex; align-items: center; gap: 1rem; }
    .logo-badge {
      width: 48px; height: 48px;
      background: linear-gradient(135deg, #3B82F6, #10B981);
      border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.5rem; font-weight: bold;
      box-shadow: 0 10px 25px -5px rgba(59, 130, 246, 0.5);
    }
    .title-area h1 { font-size: 1.5rem; font-weight: 700; background: linear-gradient(to right, #F8FAFC, #94A3B8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .title-area p { font-size: 0.875rem; color: var(--text-muted); }
    .header-actions { display: flex; align-items: center; gap: 0.75rem; }
    .live-status {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success); padding: 0.4rem 0.8rem; border-radius: 20px; font-size: 0.85rem; font-weight: 500;
    }
    .dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    
    /* Stats Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; margin-bottom: 2.5rem; }
    .stat-card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      backdrop-filter: blur(12px); border-radius: 16px; padding: 1.5rem;
      transition: transform 0.2s, border-color 0.2s;
    }
    .stat-card:hover { transform: translateY(-3px); border-color: rgba(255, 255, 255, 0.25); }
    .stat-label { font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #FFFFFF; }
    .stat-sub { font-size: 0.75rem; color: var(--success); margin-top: 0.25rem; }

    /* Category Select & Reset Bar */
    .filter-bar {
      background: var(--card-bg); border: 1px solid var(--card-border);
      backdrop-filter: blur(12px); border-radius: 16px; padding: 1.25rem;
      margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 1rem;
    }
    .filter-title { font-size: 1rem; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 0.5rem; }
    .group-checkboxes { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
    .group-chip {
      display: inline-flex; align-items: center; gap: 0.5rem;
      background: rgba(255, 255, 255, 0.05); border: 1px solid var(--card-border);
      padding: 0.5rem 0.9rem; border-radius: 10px; font-size: 0.85rem; cursor: pointer; user-select: none;
      transition: all 0.2s;
    }
    .group-chip.active { background: rgba(59, 130, 246, 0.2); border-color: var(--primary); color: #FFFFFF; font-weight: 500; }
    .group-chip input { cursor: pointer; accent-color: var(--primary); }

    .btn-reset {
      background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4);
      color: var(--danger); padding: 0.5rem 1rem; border-radius: 10px;
      font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
      display: inline-flex; align-items: center; gap: 0.4rem;
    }
    .btn-reset:hover { background: var(--danger); color: #FFFFFF; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4); }

    .btn-excel {
      background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4);
      color: var(--success); padding: 0.5rem 1rem; border-radius: 10px;
      font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
      display: inline-flex; align-items: center; gap: 0.4rem;
    }
    .btn-excel:hover { background: var(--success); color: #FFFFFF; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4); }

    .btn-upload-excel {
      background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.4);
      color: var(--primary); padding: 0.5rem 1rem; border-radius: 10px;
      font-size: 0.85rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
      display: inline-flex; align-items: center; gap: 0.4rem;
    }
    .btn-upload-excel:hover { background: var(--primary); color: #FFFFFF; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); }

    /* Table Container */
    .table-card {
      background: var(--card-bg); border: 1px solid var(--card-border);
      backdrop-filter: blur(12px); border-radius: 16px; overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: rgba(15, 23, 42, 0.8); color: var(--text-muted); font-size: 0.85rem; font-weight: 600; padding: 1rem 1.25rem; border-bottom: 1px solid var(--card-border); }
    td { padding: 1rem 1.25rem; font-size: 0.9rem; border-bottom: 1px solid rgba(255, 255, 255, 0.05); }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .badge-no { display: inline-block; width: 28px; height: 28px; background: rgba(59, 130, 246, 0.15); color: var(--primary); text-align: center; line-height: 28px; border-radius: 8px; font-weight: 600; font-size: 0.85rem; }
    .amount-text { color: var(--success); font-weight: 600; }
    .empty-state { text-align: center; padding: 3rem; color: var(--text-muted); font-size: 0.95rem; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-area">
        <div class="logo-badge">🏫</div>
        <div class="title-area">
          <h1>School-Bot Web Dashboard</h1>
          <p>ระบบรวมข้อมูลยอดโอนเงินสลิป เลือกดูบางกลุ่ม + ปุ่มรีเซ็ตบนเว็บ 24 ชม.</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn-excel" onclick="exportToExcel()" title="ดาวน์โหลดสรุปยอดสลิปเป็นไฟล์ Excel">📊 ส่งออก Excel (.xlsx)</button>
        <button class="btn-upload-excel" onclick="document.getElementById('excel-file-input').click()" title="นำเข้าข้อมูลสลิปจากไฟล์ Excel">📤 อัปโหลด Excel (.xlsx)</button>
        <input type="file" id="excel-file-input" accept=".xlsx, .xls, .csv" style="display:none;" onchange="handleExcelUpload(event)">
        <button class="btn-reset" onclick="confirmReset('ALL')">⚠️ รีเซ็ตทุกกลุ่มรวมกัน</button>
        <div class="live-status">
          <div class="dot"></div>
          <span>ออนไลน์ 24 ชม.</span>
        </div>
      </div>
    </header>

    <!-- Stats Cards -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">ยอดโอนรวมกลุ่มที่เลือก</div>
        <div class="stat-value" id="stat-selected-amount">0.00 ฿</div>
        <div class="stat-sub">คำนวณตามกลุ่มที่เลือก</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">จำนวนสลิปกลุ่มที่เลือก</div>
        <div class="stat-value" id="stat-selected-slips">0 รายการ</div>
        <div class="stat-sub">อัปเดตแบบ Real-time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">จำนวนกลุ่ม LINE ทั้งหมด</div>
        <div class="stat-value" id="stat-total-groups">0 กลุ่ม</div>
        <div class="stat-sub">แยกหมวดหมู่อิสระ</div>
      </div>
    </div>

    <!-- Group Multiselect Filter & Reset Control -->
    <div class="filter-bar">
      <div class="filter-title">
        <span>📁 เลือกกลุ่มที่ต้องการแสดงข้อมูล:</span>
      </div>
      <div class="group-checkboxes" id="group-checkboxes">
        <!-- Render Chips Dynamically -->
      </div>
      <div>
        <button class="btn-reset" onclick="resetSelectedGroups()">🔄 รีเซ็ตกลุ่มที่เลือก</button>
      </div>
    </div>

    <!-- Data Table -->
    <div class="table-card">
      <table>
        <thead>
          <tr>
            <th style="width: 80px;">ลำดับ</th>
            <th>ชื่อผู้โอนเงิน (สลิป/LINE)</th>
            <th>ผู้รับเงิน / บัญชีปลายทาง</th>
            <th>จำนวนเงิน (บาท)</th>
            <th>วันเวลาที่โอน</th>
            <th>หมวดหมู่กลุ่ม LINE</th>
          </tr>
        </thead>
        <tbody id="table-body">
          <tr>
            <td colspan="6" class="empty-state">กำลังดึงข้อมูลสลิปล่าสุด...</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    let globalData = null;
    let selectedGroupSet = new Set(['ALL']);

    async function loadDashboardData() {
      try {
        const res = await fetch('/api/data');
        const data = await res.json();
        globalData = data;

        document.getElementById('stat-total-groups').innerText = data.totalGroups + ' กลุ่ม';

        renderGroupChips(data.groups);
        renderFilteredTable();
      } catch (err) {
        console.error('Error loading data:', err);
      }
    }

    function renderGroupChips(groups) {
      const container = document.getElementById('group-checkboxes');
      const gNames = Object.keys(groups);

      let html = \`
        <label class="group-chip \${selectedGroupSet.has('ALL') ? 'active' : ''}">
          <input type="checkbox" \${selectedGroupSet.has('ALL') ? 'checked' : ''} onchange="toggleSelectGroup('ALL')">
          🌐 เลือกทุกกลุ่ม
        </label>
      \`;

      gNames.forEach(gName => {
        const isChecked = selectedGroupSet.has('ALL') || selectedGroupSet.has(gName);
        html += \`
          <label class="group-chip \${isChecked ? 'active' : ''}">
            <input type="checkbox" \${isChecked ? 'checked' : ''} onchange="toggleSelectGroup('\${gName}')">
            📁 \${gName}
          </label>
        \`;
      });

      container.innerHTML = html;
    }

    function toggleSelectGroup(groupName) {
      if (groupName === 'ALL') {
        if (selectedGroupSet.has('ALL')) {
          selectedGroupSet.clear();
        } else {
          selectedGroupSet.clear();
          selectedGroupSet.add('ALL');
        }
      } else {
        selectedGroupSet.delete('ALL');
        if (selectedGroupSet.has(groupName)) {
          selectedGroupSet.delete(groupName);
        } else {
          selectedGroupSet.add(groupName);
        }
      }

      if (globalData && globalData.groups) {
        renderGroupChips(globalData.groups);
      }
      renderFilteredTable();
    }

    function renderFilteredTable() {
      const tbody = document.getElementById('table-body');
      tbody.innerHTML = '';

      if (!globalData || !globalData.groups) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ยังไม่มีข้อมูลสลิปในขณะนี้</td></tr>';
        return;
      }

      let filteredItems = [];
      let totalAmountSum = 0;

      Object.keys(globalData.groups).forEach(gName => {
        if (selectedGroupSet.has('ALL') || selectedGroupSet.has(gName)) {
          globalData.groups[gName].forEach(item => {
            filteredItems.push({ ...item, groupCategory: gName });
            const parsedNum = parseFloat(String(item.amount).replace(/,/g, ''));
            if (!isNaN(parsedNum)) totalAmountSum += parsedNum;
          });
        }
      });

      document.getElementById('stat-selected-amount').innerText = Number(totalAmountSum).toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' ฿';
      document.getElementById('stat-selected-slips').innerText = filteredItems.length + ' รายการ';

      if (filteredItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">กรุณาเลือกกลุ่มด้านบนเพื่อแสดงข้อมูลสลิป</td></tr>';
        return;
      }

      filteredItems.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = \`
          <td><span class="badge-no">#\${item.orderNo}</span></td>
          <td style="font-weight: 500;">\${item.senderName}</td>
          <td style="color: #60A5FA;">\${item.receiverName}</td>
          <td class="amount-text">\${item.amount} ฿</td>
          <td style="color: var(--text-muted); font-size: 0.85rem;">\${item.slipDateTime || item.timestamp}</td>
          <td><span style="background: rgba(255,255,255,0.08); padding: 0.2rem 0.6rem; border-radius: 6px; font-size: 0.8rem;">\${item.groupCategory}</span></td>
        \`;
        tbody.appendChild(tr);
      });
    }

    async function confirmReset(groupName) {
      const targetName = groupName === 'ALL' ? 'ทุกกลุ่ม' : groupName;
      if (confirm(\`คุณต้องการรีเซ็ตล้างลำดับข้อมูลสลิปของ "\${targetName}" หรือไม่?\`)) {
        try {
          const res = await fetch('/api/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ group: groupName })
          });
          const result = await res.json();
          alert(result.message);
          loadDashboardData();
        } catch (e) {
          alert('เกิดข้อผิดพลาดในการสั่งรีเซ็ต');
        }
      }
    }

    async function resetSelectedGroups() {
      if (selectedGroupSet.has('ALL')) {
        confirmReset('ALL');
      } else {
        const list = Array.from(selectedGroupSet);
        if (list.length === 0) {
          alert('กรุณาเลือกกลุ่มที่ต้องการรีเซ็ตก่อนครับ');
          return;
        }
        if (confirm(\`คุณต้องการรีเซ็ตกลุ่มที่เลือกจำนวน \${list.length} กลุ่ม หรือไม่?\`)) {
          for (const g of list) {
            await fetch('/api/reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ group: g })
            });
          }
          alert('ทำการรีเซ็ตกลุ่มที่เลือกเรียบร้อยแล้ว');
          loadDashboardData();
        }
      }
    }

    loadDashboardData();
    setInterval(loadDashboardData, 10000);
  </script>
</body>
</html>`;
  res.send(html);
});

app.post('/api/webhook', async (req, res) => {
  try {
    const events = req.body.events;
    const reqHost = req.headers.host;
    if (events && events.length > 0) {
      for (const event of events) {
        if (event.type === 'message') {
          if (event.message.type === 'image') {
            await handleImageMessage(event, reqHost);
          } else if (event.message.type === 'text') {
            await handleTextMessage(event, reqHost);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error handling webhook:', error.message);
  }

  res.status(200).send('OK');
});

async function handleTextMessage(event, reqHost) {
  if (!event || !event.replyToken || !event.message || !event.message.text) return;

  const userText = event.message.text.trim().toLowerCase();
  const replyToken = event.replyToken;
  const contextId = await getContextId(event);
  const currentRecords = getGroupRecords(contextId);

  if (userText.includes('รีเซ็ต') || userText.includes('reset') || userText.includes('ล้าง')) {
    resetGroupRecords(contextId);
    const replyText = `🔄 **ทำการรีเซ็ตรายชื่อผู้โอนเงินเฉพาะกลุ่มนี้เรียบร้อยแล้วครับ!**\n` +
                      `----------------------------------\n` +
                      `💡 สลิปถัดไปของกลุ่มนี้จะเริ่มนับเป็นลำดับที่ 1 ใหม่ครับ`;
    await replyLineMessage(replyToken, replyText);
  } else if (userText.includes('เช็ค') || userText.includes('ping') || userText.includes('ทดสอบ') || userText.includes('status')) {
    const flexMessage = buildStatusFlexMessage(currentRecords.length);
    await replyLineFlexMessage(replyToken, flexMessage);
  } else if (userText.includes('สรุป') || userText.includes('รายชื่อ')) {
    const flexMessage = buildSummaryFlexMessage(currentRecords, contextId, reqHost);
    await replyLineFlexMessage(replyToken, flexMessage);
  }
}

async function handleImageMessage(event, reqHost) {
  if (!event || !event.replyToken) return;

  const replyToken = event.replyToken;
  const messageId = event.message.id;
  const userId = event.source ? event.source.userId : null;
  const groupId = event.source ? event.source.groupId : null;
  const contextId = await getContextId(event);
  const timestampNow = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });

  const [lineUserName, imageBuffer] = await Promise.all([
    getLineUserProfile(groupId, userId),
    getLineImageBuffer(messageId)
  ]);

  const userDisplayName = lineUserName || "ผู้ปกครอง";
  let senderName = userDisplayName;
  let receiverName = "โรงเรียน / บัญชีรับเงิน";
  let amount = "ระบุตามสลิป";
  let slipDateTime = timestampNow;

  if (imageBuffer) {
    const slipInfo = await extractSlipDataWithGemini(imageBuffer);
    if (slipInfo) {
      if (slipInfo.sender_name && slipInfo.sender_name !== "null" && slipInfo.sender_name.trim() !== "") {
        senderName = slipInfo.sender_name;
      }
      if (slipInfo.receiver_name && slipInfo.receiver_name !== "null" && slipInfo.receiver_name.trim() !== "") {
        receiverName = slipInfo.receiver_name;
      }
      if (slipInfo.amount && slipInfo.amount !== "null" && slipInfo.amount.trim() !== "") {
        amount = slipInfo.amount;
      }
      if (slipInfo.transfer_date_time && slipInfo.transfer_date_time !== "null" && slipInfo.transfer_date_time.trim() !== "") {
        slipDateTime = slipInfo.transfer_date_time;
      }
    }
  }

  const currentRecords = getGroupRecords(contextId);
  const newOrderNo = currentRecords.length + 1;
  const recordItem = {
    orderNo: newOrderNo,
    senderName: senderName,
    receiverName: receiverName,
    amount: amount,
    slipDateTime: slipDateTime,
    timestamp: timestampNow
  };
  currentRecords.push(recordItem);

  const flexCard = buildSlipSuccessFlexCard(recordItem, currentRecords, contextId, reqHost);

  await replyLineFlexMessage(replyToken, flexCard);
}

function buildSlipSuccessFlexCard(item, allRecords, contextId, reqHost) {
  let summaryRows = allRecords.map(r => {
    return {
      type: "box",
      layout: "horizontal",
      margin: "sm",
      contents: [
        { type: "text", text: `${r.orderNo}.`, size: "xs", color: "#4A5568", weight: "bold", flex: 1 },
        { type: "text", text: `${r.senderName}`, size: "xs", color: "#2D3748", flex: 4, wrap: true },
        { type: "text", text: `${r.amount}B (${r.slipDateTime})`, size: "xs", color: "#276749", align: "end", flex: 5 }
      ]
    };
  });

  if (summaryRows.length > 10) {
    summaryRows = summaryRows.slice(-10);
  }

  const host = reqHost || 'school-bot-ten.vercel.app';
  const downloadUrl = `https://${host}/api/export-excel?group=${encodeURIComponent(contextId || 'ALL')}`;

  return {
    type: "flex",
    altText: `✅ บันทึกสลิปสำเร็จ (ลำดับที่ ${item.orderNo})`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1A365D",
        paddingAll: "lg",
        contents: [
          {
            type: "text",
            text: "✅ บันทึกการโอนเงินสำเร็จ",
            weight: "bold",
            color: "#FFFFFF",
            size: "md"
          },
          {
            type: "text",
            text: `ลำดับรายการที่ #${item.orderNo} (${contextId || 'กลุ่มทั่วไป'})`,
            color: "#E2E8F0",
            size: "xs",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "lg",
        backgroundColor: "#FFFFFF",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "👤 ผู้โอนเงิน", size: "sm", color: "#718096", flex: 4 },
              { type: "text", text: item.senderName, size: "sm", color: "#1A202C", weight: "bold", flex: 6, wrap: true }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            contents: [
              { type: "text", text: "🏢 ผู้รับเงิน", size: "sm", color: "#718096", flex: 4 },
              { type: "text", text: item.receiverName, size: "sm", color: "#2B6CB0", weight: "bold", flex: 6, wrap: true }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            contents: [
              { type: "text", text: "💵 จำนวนเงิน", size: "sm", color: "#718096", flex: 4 },
              { type: "text", text: `${item.amount} บาท`, size: "sm", color: "#276749", weight: "bold", flex: 6 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "md",
            contents: [
              { type: "text", text: "📅 วันเวลาโอน", size: "sm", color: "#718096", flex: 4 },
              { type: "text", text: item.slipDateTime, size: "sm", color: "#4A5568", weight: "bold", flex: 6, wrap: true }
            ]
          },
          { type: "separator", margin: "lg" },
          {
            type: "text",
            text: `📋 สรุปรายชื่อผู้โอนทั้งหมด (${allRecords.length} คน):`,
            weight: "bold",
            size: "xs",
            color: "#2D3748",
            margin: "md"
          },
          {
            type: "box",
            layout: "vertical",
            margin: "sm",
            contents: summaryRows
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#F7FAFC",
        paddingAll: "md",
        contents: [
          {
            type: "text",
            text: "พิมพ์ 'รีเซ็ต' เมื่อต้องการล้างลำดับเฉพาะกลุ่มนี้เริ่มนับ 1 ใหม่",
            size: "xxs",
            color: "#A0AEC0",
            align: "center"
          }
        ]
      }
    }
  };
}

function buildStatusFlexMessage(totalCount) {
  return {
    type: "flex",
    altText: "🤖 บอทสแกนสลิป พร้อมใช้งาน",
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1A365D",
        contents: [
          { type: "text", text: "🤖 ระบบสแกนสลิปพร้อมใช้งาน", color: "#FFFFFF", weight: "bold" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: `📊 จำนวนผู้โอนสะสมในกลุ่มนี้: ${totalCount} คน`, size: "sm", weight: "bold", color: "#276749" },
          { type: "text", text: "💡 สามารถพิมพ์คำว่า 'รีเซ็ต' เพื่อล้างลำดับเฉพาะกลุ่มนี้ได้", size: "xs", color: "#718096", margin: "md" }
        ]
      }
    }
  };
}

function buildSummaryFlexMessage(allRecords, contextId, reqHost) {
  const flexCard = buildSlipSuccessFlexCard(
    allRecords.length > 0 ? allRecords[allRecords.length - 1] : { orderNo: 0, senderName: "-", receiverName: "-", amount: "0", slipDateTime: "-" },
    allRecords,
    contextId,
    reqHost
  );
  return flexCard;
}

async function getLineUserProfile(groupId, userId) {
  if (!userId) return null;
  try {
    let url = `https://api.line.me/v2/bot/profile/${userId}`;
    const res = await axiosClient.get(url, {
      headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
    });
    return res.data ? res.data.displayName : null;
  } catch (e) {
    return null;
  }
}

async function getLineImageBuffer(messageId) {
  try {
    const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
    const response = await axiosClient.get(url, {
      headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      responseType: 'arraybuffer'
    });
    return Buffer.from(response.data);
  } catch (e) {
    return null;
  }
}

async function extractSlipDataWithGemini(imageBuffer) {
  if (!GEMINI_API_KEY) return null;

  const base64Image = imageBuffer.toString('base64');
  let mimeType = 'image/jpeg';
  if (base64Image.startsWith('iVBORw0KGgo')) {
    mimeType = 'image/png';
  }

  const prompt = `ช่วยอ่านรูปภาพสลิปโอนเงิน/เติมเงิน/จ่ายบิลนี้ ตอบกลับเป็น JSON ดังนี้เท่านั้น:
{
  "is_slip": true,
  "sender_name": "ชื่อผู้โอน หรือ ผู้ทำรายการ (เช่น นาย พุฒิพงศ์ ร...)",
  "receiver_name": "ชื่อผู้รับเงิน หรือ บัญชีปลายทาง หรือ ร้านค้า (เช่น นาย พรกริศน์ เดชะอัครมงคล)",
  "amount": "จำนวนเงินตัวเลข เช่น 70.00",
  "transfer_date_time": "วัน เดือน ปี และเวลาที่โอนเงิน เช่น 22 ก.ค. 2569 - 21:23"
}`;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64Image } }
      ]
    }],
    generationConfig: { response_mime_type: 'application/json' }
  };

  const models = ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-pro-latest'];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await axiosClient.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.data && response.data.candidates && response.data.candidates[0]) {
        let resText = response.data.candidates[0].content.parts[0].text;
        resText = resText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(resText);
        if (parsed) return parsed;
      }
    } catch (e) {
      console.error(`Error with model ${model}:`, e.message);
    }
  }

  return null;
}

async function replyLineMessage(replyToken, text) {
  try {
    await axiosClient.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (e) {
    console.error('Error replying LINE message:', e.message);
  }
}

async function replyLineFlexMessage(replyToken, flexJson) {
  try {
    await axiosClient.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [flexJson]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });
  } catch (e) {
    console.error('Error replying LINE Flex message:', e.message);
  }
}

module.exports = app;
