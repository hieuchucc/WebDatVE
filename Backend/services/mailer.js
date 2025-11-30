const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE||'false') === 'true', 
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

function fmtMoney(n){ return (Number(n||0)).toLocaleString('vi-VN'); }

function ticketPaidHtml(booking){
  const trip = booking.trip || booking.tripId || {};
  const c = booking.customer || {};
  const seats = (booking.seatCodes||[]).join(', ');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
    <h2>Vé đã thanh toán ✅</h2>
    <p>Xin chào <b>${c.name||''}</b>, đơn đặt vé của bạn đã được xác nhận.</p>
    <table style="border-collapse:collapse">
      <tr><td style="padding:4px 8px">Mã đặt vé:</td><td><b>${booking._id}</b></td></tr>
      <tr><td style="padding:4px 8px">Tuyến:</td><td><b>${trip.routeCode||'-'}</b></td></tr>
      <tr><td style="padding:4px 8px">Ngày/giờ:</td><td><b>${trip.dateStr||'-'} ${trip.departHM||''}</b></td></tr>
      <tr><td style="padding:4px 8px">Ghế:</td><td><b>${seats||'-'}</b></td></tr>
      <tr><td style="padding:4px 8px">Số tiền:</td><td><b>${fmtMoney(booking.payment?.amount||0)} đ</b></td></tr>
      <tr><td style="padding:4px 8px">Phương thức:</td><td><b>${booking.payment?.method||'vnpay'}</b></td></tr>
    </table>
    <p>Vui lòng có mặt trước giờ khởi hành 15–20 phút. Cảm ơn bạn đã sử dụng dịch vụ!</p>
  </div>`;
}

function departReminderHtml(booking, mins){
  const trip = booking.trip || booking.tripId || {};
  const c = booking.customer || {};
  const seats = (booking.seatCodes||[]).join(', ');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6">
    <h3>Nhắc lịch khởi hành 🚌</h3>
    <p>Chào <b>${c.name||''}</b>, chuyến <b>${trip.routeCode||'-'}</b> của bạn sẽ khởi hành lúc <b>${trip.dateStr||'-'} ${trip.departHM||''}</b>.</p>
    <ul>
      <li>Mã đặt vé: <b>${booking._id}</b></li>
      <li>Ghế: <b>${seats||'-'}</b></li>
    </ul>
    <p>Đây là email nhắc trước ~${mins} phút. Vui lòng đến bến trước 15–20 phút.</p>
  </div>`;
}

async function sendMail({ to, subject, html, attachments }){
  if(!to) return;
  return transporter.sendMail({ from: process.env.MAIL_FROM, to, subject, html, attachments });
}

async function sendTicketPaidEmail(booking){
  const to = booking.customer?.email;
  if(!to) return;
  return sendMail({
    to,
    subject: `Vé đã thanh toán - ${booking._id}`,
    html: ticketPaidHtml(booking)
  });
}

async function sendDepartReminderEmail(booking, mins){
  const to = booking.customer?.email;
  if(!to) return;
  return sendMail({
    to,
    subject: `Nhắc lịch khởi hành (${booking._id})`,
    html: departReminderHtml(booking, mins)
  });
}

module.exports = {
  sendTicketPaidEmail,
  sendDepartReminderEmail
};
