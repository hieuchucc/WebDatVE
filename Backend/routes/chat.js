const express = require('express');
const router = express.Router();
const { Trip } = require('../models/Trip');
const { ChatMessage } = require('../models/ChatMessage');

// Bỏ dấu + về lowercase
function normalize(str = '') {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const PLACE_KEYWORDS = {
  lagi: ['lagi', 'la gi', 'ham tan', 'hàm tân'],
  hcm: ['hcm', 'sai gon', 'tp.hcm', 'tp ho chi minh', 'tp hò chí minh', 'tp hồ chí minh'],
  dalat: ['da lat', 'đà lạt', 'dalat'],
  ntrang: ['nha trang', 'n trang', 'ntrang'],
};

// Từ câu hỏi suy ra routeCode
function detectRoute(textRaw = '') {
  const text = normalize(textRaw);

  const includesAny = (list) => list.some(k => text.includes(k));

  const hasLagi   = includesAny(PLACE_KEYWORDS.lagi);
  const hasHcm    = includesAny(PLACE_KEYWORDS.hcm);
  const hasDalat  = includesAny(PLACE_KEYWORDS.dalat);
  const hasNtrang = includesAny(PLACE_KEYWORDS.ntrang);

  // Lagi – HCM
  if (hasLagi && hasHcm) {
    if (/tu hcm|từ hcm|chieu ve|chiều về|ve lai|về lại/i.test(text)) {
      return { routeCode: 'HCM-LAGI', from: 'TP.HCM', to: 'Lagi' };
    }
    return { routeCode: 'LAGI-HCM', from: 'Lagi', to: 'TP.HCM' };
  }

  // Lagi – Đà Lạt
  if (hasLagi && hasDalat) {
    if (/tu da lat|từ đà lạt|chieu ve|chiều về|ve lai|về lại/i.test(text)) {
      return { routeCode: 'DALAT-LAGI', from: 'Đà Lạt', to: 'Lagi' };
    }
    return { routeCode: 'LAGI-DALAT', from: 'Lagi', to: 'Đà Lạt' };
  }

  // Lagi – Nha Trang
  if (hasLagi && hasNtrang) {
    if (/tu nha trang|từ nha trang|chieu ve|chiều về|ve lai|về lại/i.test(text)) {
      return { routeCode: 'NTRANG-LAGI', from: 'Nha Trang', to: 'Lagi' };
    }
    return { routeCode: 'LAGI-NTRANG', from: 'Lagi', to: 'Nha Trang' };
  }

  return null;
}

const fmtMoney = (n) => (Number(n || 0)).toLocaleString('vi-VN');

// POST /api/chat
router.post('/', async (req, res) => {
  try {
    let text = '';

    // HỖ TRỢ nhiều kiểu body nhưng **ưu tiên req.body.text**
    if (typeof req.body.text === 'string') {
      text = req.body.text;
    } else if (Array.isArray(req.body.messages) && req.body.messages.length) {
      const last = req.body.messages[req.body.messages.length - 1];
      text = last?.content || last?.text || '';
    } else if (typeof req.body.message === 'string') {
      text = req.body.message;
    }

    text = (text || '').trim();
    if (!text) {
      return res.status(400).json({ message: 'Missing text' });
    }

    // Lưu câu hỏi
    await ChatMessage.create({
      role: 'user',
      content: text,
    });

    const norm = normalize(text);
    const routeInfo   = detectRoute(text);
    const askPrice    = /gia|giá|bao nhieu|bao nhiêu|bn|tien ve|tiền vé|vé bao nhiêu/i.test(norm);
    const askTime     = /may gio|mấy giờ|gio chay|giờ chạy|khoi hanh|khởi hành|gio nao/i.test(norm);
    const askTomorrow = /ngay mai|ngày mai|mai/i.test(norm);

    let reply = '';

    if (routeInfo) {
      const now = new Date();
      let dateStr;

      if (askTomorrow) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        dateStr = d.toISOString().slice(0, 10);
      } else {
        dateStr = now.toISOString().slice(0, 10); // hôm nay
      }

      const trips = await Trip.find({
        routeCode: routeInfo.routeCode,
        dateStr,
        active: true,
      })
        .sort({ departAt: 1 })
        .lean();

      if (!trips.length) {
        reply =
          `Hiện chưa có chuyến ${routeInfo.from} – ${routeInfo.to} ` +
          `vào ngày ${dateStr}. Bạn có thể chọn ngày khác hoặc gọi hotline để được hỗ trợ.`;
      } else {
        const lines = trips.map(
          (t) => `• ${t.departHM} – khoảng ${fmtMoney(t.price)}đ`
        );
        reply =
          `Các chuyến ${routeInfo.from} – ${routeInfo.to} ngày ${dateStr}:\n` +
          lines.join('\n') +
          `\n\nBạn có thể vào phần "Tìm chuyến" để đặt vé chi tiết.`;
      }
    } else if (askPrice || askTime) {
      reply =
        'Bạn vui lòng ghi rõ tuyến (ví dụ: "Lagi đi Nha Trang", "HCM về Lagi") ' +
        'và ngày đi để mình tra cứu chính xác giờ chạy và giá vé nhé.';
    } else {
      reply =
        'Xin chào 👋, mình là trợ lý đặt vé.\n' +
        'Bạn có thể hỏi: "Giá vé Lagi đi Đà Lạt ngày mai?", ' +
        '"Giờ chạy từ Lagi lên HCM hôm nay?" v.v.';
    }

    // Lưu câu trả lời bot
    await ChatMessage.create({
      role: 'bot',
      content: reply,
    });

    return res.json({ reply });
  } catch (e) {
    console.error('Chat error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;