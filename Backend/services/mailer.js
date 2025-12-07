const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTicketPaidEmail(booking) {
  try {
    // 1. Kiểm tra booking & email
    if (!booking) {
      console.error('sendTicketPaidEmail: booking is null/undefined');
      return;
    }

    if (!booking.email) {
      console.error('sendTicketPaidEmail: booking.email is missing', {
        bookingId: booking._id,
      });
      return;
    }

    // 2. Lấy trip (nếu có)
    const trip = booking.trip || {};

    const htmlContent = `
      <h2>Thanh toán thành công</h2>
      <p><strong>Mã vé:</strong> ${booking._id}</p>
      <p><strong>Tuyến:</strong> ${trip.routeCode || ''}</p>
      <p><strong>Ngày đi:</strong> ${trip.dateStr || ''}</p>
      <p><strong>Giờ khởi hành:</strong> ${trip.departHM || ''}</p>
      <br/>
      <p>Cảm ơn bạn đã đặt vé.</p>
    `;

    // 3. from: nếu mày chưa set MAIL_FROM thì fallback về onboarding@resend.dev
    const fromAddress =
      process.env.MAIL_FROM || 'Booking App <onboarding@resend.dev>';

    console.log('Sending email via Resend:', {
      from: fromAddress,
      to: booking.email,
    });

    const result = await resend.emails.send({
      from: fromAddress,
      to: booking.email,
      subject: 'Thanh toán thành công',
      html: htmlContent,
    });

    console.log('Email sent via Resend OK:', result);
  } catch (err) {
    console.error(
      'Email send error:',
      err?.response?.data || err?.response?.body || err
    );
  }
}

module.exports = { sendTicketPaidEmail };