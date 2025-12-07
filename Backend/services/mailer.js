const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTicketPaidEmail(booking) {
  try {
    const trip = booking.trip || {};

    const htmlContent = `
      <h2>Thanh toán thành công</h2>
      <p><strong>Mã vé:</strong> ${booking._id}</p>
      <p><strong>Tuyến:</strong> ${trip.routeCode || ""}</p>
      <p><strong>Ngày đi:</strong> ${trip.dateStr || ""}</p>
      <p><strong>Giờ khởi hành:</strong> ${trip.departHM || ""}</p>
      <br/>
      <p>Cảm ơn bạn đã đặt vé.</p>
    `;

    await resend.emails.send({
      from: process.env.MAIL_FROM,
      to: booking.email,
      subject: "Thanh toán thành công",
      html: htmlContent,
    });

    console.log("Email sent via Resend!");
  } catch (err) {
    console.error("Email send error:", err);
  }
}

module.exports = { sendTicketPaidEmail };