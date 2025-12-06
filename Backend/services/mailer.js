const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  MAIL_FROM,
  RESEND_API_KEY,
} = process.env;

// ========== RESEND ==========
let resend = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
  console.log("[MAIL] Resend initialized ✔");
}

// ========== SMTP TRANSPORTER ==========
let transporter = null;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || 'false') === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
    requireTLS: true,
  });
  console.log("[MAIL] SMTP transporter created ✔");
} else {
  console.log("[MAIL] SMTP not configured → will use RESEND fallback");
}

// ========== TEMPLATES ==========
function fmtMoney(n) {
  return Number(n || 0).toLocaleString('vi-VN');
}

function ticketPaidHtml(booking) {
  const trip = booking.trip || booking.tripId || {};
  const c = booking.customer || {};
  const seats = (booking.seatCodes || []).join(', ');

  return `
    <h2>Vé đã thanh toán</h2>
    <p>Xin chào <b>${c.name}</b></p>
    <p>Mã đặt vé: <b>${booking._id}</b></p>
    <p>Tuyến: <b>${trip.routeCode}</b></p>
    <p>Thời gian: ${trip.dateStr} ${trip.departHM}</p>
    <p>Ghế: ${seats}</p>
    <p>Số tiền: <b>${fmtMoney(booking.payment?.amount)} đ</b></p>
  `;
}

// ========== CORE SEND MAIL (SMTP → fallback RESEND) ==========
async function sendMail({ to, subject, html }) {
  if (!to) return console.warn("[MAIL] Missing email");

  // 1) Try SMTP first if exists
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: MAIL_FROM || SMTP_USER,
        to,
        subject,
        html,
      });
      console.log("[MAIL] Sent OK (SMTP):", info.messageId);
      return info;
    } catch (err) {
      console.error("[MAIL] SMTP ERROR:", err.message);
    }
  }

  // 2) RESEND fallback
  if (resend) {
    try {
      const res = await resend.emails.send({
        from: MAIL_FROM,
        to,
        subject,
        html,
      });
      console.log("[MAIL] Sent OK (RESEND):", res);
      return res;
    } catch (e) {
      console.error("[MAIL] RESEND ERROR:", e.message);
    }
  }

  console.error("[MAIL] FAILED — no SMTP and no RESEND");
}

// ========== PUBLIC API ==========
async function sendTicketPaidEmail(booking) {
  const email = booking.customer?.email;
  if (!email) return console.log("[MAIL] Booking lacks email");

  return sendMail({
    to: email,
    subject: `Vé đã thanh toán - ${booking._id}`,
    html: ticketPaidHtml(booking),
  });
}

module.exports = { sendTicketPaidEmail };