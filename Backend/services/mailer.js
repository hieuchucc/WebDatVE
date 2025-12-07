const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTicketPaidEmail(booking) {
  try {
    if (!booking) {
      console.error("Booking null");
      return;
    }

    // LẤY EMAIL TỪ customer.email
    const email = booking.customer?.email;
    if (!email) {
      console.error("sendTicketPaidEmail: booking.customer.email MISSING", {
        bookingId: booking._id
      });
      return;
    }

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

    const fromAddress =
      process.env.MAIL_FROM || "bavexetructuyen <onboarding@resend.dev>";

    const result = await resend.emails.send({
      from: fromAddress,
      to: email, 
      subject: "Thanh toán thành công",
      html: htmlContent,
    });

    console.log("Email sent via Resend OK:", result);
  } catch (err) {
    console.error(
      "Email send error:",
      err?.response?.data || err?.response?.body || err
    );
  }
}

module.exports = { sendTicketPaidEmail };
