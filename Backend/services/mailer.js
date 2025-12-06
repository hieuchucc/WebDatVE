
const nodemailer = require('nodemailer');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  SENDGRID_API_KEY, 
} = process.env;


let transporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
  
    secure: String(SMTP_SECURE || 'false') === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
    requireTLS: true,
    logger: true,   
    debug: true,    
  });
  console.log('[MAIL] transporter created (SMTP_HOST set)');
} else {
  console.warn(
    '[MAIL] SMTP config thiếu (SMTP_HOST / SMTP_USER / SMTP_PASS). ' +
      'Sẽ không gửi email, chỉ log. Consider using SENDGRID_API_KEY as fallback.'
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

async function sendMail({ to, subject, html, attachments }) {
  if (!to) {
    console.warn('[MAIL] sendMail: missing "to" address');
    return;
  }

  if (!transporter) {
    console.log('[MAIL] SKIP sendMail (no transporter). Consider enabling SENDGRID fallback.');
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
    console.log('[MAIL] Sent OK:', info && info.messageId);
    return info;
  } catch (err) {
    
    console.error('[MAIL] Error sendMail:', err && (err.code || err.message || err));
    if (err && err.code === 'ETIMEDOUT') {
      console.error('[MAIL] ETIMEDOUT — likely outbound SMTP blocked by host (Render may block SMTP).');
      console.error('[MAIL] Suggestion: Use email-sending service via HTTP API (SendGrid / Mailgun / Postmark).');
    }
    return null;
  }
}

async function sendTicketPaidEmail(booking) {
  console.log('[MAIL] >>> sendTicketPaidEmail called, bookingId =', booking?._id, 'email =', booking?.customer?.email);
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
  console.log('[MAIL] >>> sendDepartReminderEmail called, bookingId =', booking?._id, 'email =', booking?.customer?.email);
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
