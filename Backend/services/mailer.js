const nodemailer = require('nodemailer');
require('dotenv').config();

/**
 * Tạo transporter SMTP
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === "true", // "false" => false
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * Hàm gửi email xác nhận booking
 */
async function sendBookingEmail(booking) {
  const trip = booking.tripId;

  const html = `
    <h2>📢 Xác nhận thanh toán thành công</h2>
    <p><strong>Mã đặt vé:</strong> ${booking._id}</p>

    <h3>Thông tin khách hàng</h3>
    <p><strong>Họ tên:</strong> ${booking.customer.name}</p>
    <p><strong>SĐT:</strong> ${booking.customer.phone}</p>
    <p><strong>Email:</strong> ${booking.customer.email}</p>

    <h3>Thông tin chuyến xe</h3>
    <p><strong>Tuyến:</strong> ${trip.from} → ${trip.to}</p>
    <p><strong>Khởi hành:</strong> ${new Date(trip.startTime).toLocaleString()}</p>

    <h3>Thông tin ghế</h3>
    <p><strong>Ghế:</strong> ${booking.seatCodes.join(", ")}</p>

    <h3>Thanh toán</h3>
    <p><strong>Phương thức:</strong> ${booking.payment.method.toUpperCase()}</p>
    <p><strong>Số tiền:</strong> ${booking.payment.amount.toLocaleString()} VND</p>
  `;

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: booking.customer.email,
    subject: "Xác nhận thanh toán vé xe – Thành công!",
    html
  });
}

module.exports = sendBookingEmail;
