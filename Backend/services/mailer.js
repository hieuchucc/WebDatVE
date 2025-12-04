const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
} = process.env;

// ========== Tạo transporter an toàn ==========
// Chỉ tạo nếu đủ config, tránh tạo bừa rồi ETIMEDOUT
let transporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || 'false') === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // giới hạn timeout để không chờ quá lâu
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
} else {
  console.warn(
    '[MAIL] SMTP config thiếu (SMTP_HOST / SMTP_USER / SMTP_PASS). ' +
      'Sẽ không gửi email, chỉ log.'
  );
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('vi-VN');
}

function ticketPaidHtml(booking) {
  const trip = booking.trip || booking.tripId || {};
  const c = booking.customer || {};
  const seats = (booking.seatCodes || []).join(', ');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
    <h2>Vé đã thanh toán ✅</h2>
    <p>Xin chào <b>${c.name || ''}</b>, đơn đặt vé của bạn đã được xác nhận.</p>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 8px">Mã đặt vé:</td><td><b>${booking._id}</b></td></tr>
      <tr><td style="padding:4px 8px">Tuyến:</td><td><b>${trip.routeCode || '-'}</b></td></tr>
      <tr><td style="padding:4px 8px">Ngày/giờ:</td><td><b>${trip.dateStr || '-'} ${trip.departHM || ''}</b></td></tr>
      <tr><td style="padding:4px 8px">Ghế:</td><td><b>${seats || '-'}</b></td></tr>
      <tr><td style="padding:4px 8px">Số tiền:</td><td><b>${fmtMoney(
        booking.payment?.amount || 0
      )} đ</b></td></tr>
      <tr><td style="padding:4px 8px">Phương thức:</td><td><b>${
        booking.payment?.method || 'vnpay'
      }</b></td></tr>
    </table>
    <p>Vui lòng có mặt trước giờ khởi hành 15–20 phút. Cảm ơn bạn đã sử dụng dịch vụ!</p>
  </div>`;
}

function departReminderHtml(booking, mins) {
  const trip = booking.trip || booking.tripId || {};
  const c = booking.customer || {};
  const seats = (booking.seatCodes || []).join(', ');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
    <h3>Nhắc lịch khởi hành 🚌</h3>
    <p>Chào <b>${c.name || ''}</b>, chuyến <b>${trip.routeCode || '-'}</b> của bạn sẽ khởi hành lúc <b>${
    trip.dateStr || '-'
  } ${trip.departHM || ''}</b>.</p>
    <ul>
      <li>Mã đặt vé: <b>${booking._id}</b></li>
      <li>Ghế: <b>${seats || '-'}</b></li>
    </ul>
    <p>Đây là email nhắc trước ~${mins} phút. Vui lòng đến bến trước 15–20 phút.</p>
  </div>`;
}

async function sendMail({ to, subject, html, attachments }) {
  if (!to) {
    console.warn('[MAIL] sendMail: missing "to" address');
    return;
  }

  // Nếu chưa cấu hình SMTP, không gửi, chỉ log
  if (!transporter) {
    console.log('[MAIL] SKIP sendMail (no transporter).', {
      to,
      subject,
    });
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: MAIL_FROM || SMTP_USER,
      to,
      subject,
      html,
      attachments,
    });
    console.log('[MAIL] Sent OK:', info.messageId);
    return info;
  } catch (err) {
    // 🔥 Quan trọng: nuốt lỗi, không throw ra ngoài nữa
    console.error('[MAIL] Error sendMail:', err.code || err.message || err);
    return null;
  }
}

async function sendTicketPaidEmail(booking) {
  const to = booking.customer?.email;
  if (!to) {
    console.warn('[MAIL] sendTicketPaidEmail: booking không có customer.email');
    return;
  }
  return sendMail({
    to,
    subject: `Vé đã thanh toán - ${booking._id}`,
    html: ticketPaidHtml(booking),
  });
}

async function sendDepartReminderEmail(booking, mins) {
  const to = booking.customer?.email;
  if (!to) {
    console.warn('[MAIL] sendDepartReminderEmail: booking không có customer.email');
    return;
  }
  return sendMail({
    to,
    subject: `Nhắc lịch khởi hành (${booking._id})`,
    html: departReminderHtml(booking, mins),
  });
}

module.exports = {
  sendTicketPaidEmail,
  sendDepartReminderEmail,
};
