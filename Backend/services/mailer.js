// services/mailer.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// From mặc định – nếu quên set MAIL_FROM thì vẫn có cái dùng
const DEFAULT_FROM = 'bavextructuyen <@hieuchu.site>';

// Helper: build HTML đẹp đẹp chút
function buildTicketHtml(booking) {
  const customer = booking.customer || {};
  const trip = booking.trip || {};
  const payment = booking.payment || {};
  const seats = Array.isArray(booking.seatCodes)
    ? booking.seatCodes.join(', ')
    : '';

  const amountStr = payment.amount
    ? payment.amount.toLocaleString('vi-VN') + ' VND'
    : '—';

  return `
  <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
      <div style="background:#111827;color:#fff;padding:16px 20px;">
        <h1 style="margin:0;font-size:20px;">Thanh toán thành công</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:.9;">
          Cảm ơn bạn đã đặt vé tại Bavex
        </p>
      </div>

      <div style="padding:20px 20px 8px;">
        <p style="margin:0 0 8px;">Xin chào <strong>${customer.name || 'quý khách'}</strong>,</p>
        <p style="margin:0 0 16px;">
          Thanh toán của bạn đã được ghi nhận. Thông tin vé của bạn:
        </p>

        <div style="border-radius:10px;border:1px solid #e5e7eb;padding:12px 16px;margin-bottom:16px;">
          <div style="margin-bottom:10px;">
            <div style="font-size:11px;text-transform:uppercase;color:#6b7280;">Mã đặt chỗ</div>
            <div style="font-weight:600;font-size:16px;">${booking._id}</div>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:16px;font-size:13px;color:#111827;">
            <div>
              <div style="font-size:11px;color:#6b7280;">Tuyến</div>
              <div style="font-weight:500;">${trip.routeCode || '—'}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#6b7280;">Ngày đi</div>
              <div>${trip.dateStr || '—'}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#6b7280;">Giờ khởi hành</div>
              <div>${trip.departHM || '—'}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#6b7280;">Ghế</div>
              <div>${seats || '—'}</div>
            </div>
            <div>
              <div style="font-size:11px;color:#6b7280;">Số tiền</div>
              <div>${amountStr}</div>
            </div>
          </div>
        </div>

        <div style="font-size:13px;color:#374151;margin-bottom:16px;">
          <p style="margin:0 0 6px;">Thông tin liên hệ:</p>
          <p style="margin:0;">
            📞 ${customer.phone || '—'}<br/>
            ✉️ ${customer.email || '—'}
          </p>
        </div>

        <p style="font-size:12px;color:#6b7280;margin:0 0 4px;">
          Khi lên xe, bạn chỉ cần cung cấp <strong>số điện thoại</strong> hoặc <strong>mã đặt chỗ</strong> cho nhà xe.
        </p>
        <p style="font-size:11px;color:#9ca3af;margin:0 0 6px;">
          Nếu thông tin có sai sót, vui lòng liên hệ với chúng tôi sớm nhất có thể.
        </p>
      </div>

      <div style="padding:10px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;font-size:11px;color:#9ca3af;">
        Bavex – Hệ thống đặt vé xe trực tuyến
      </div>
    </div>
  </div>
  `;
}

async function sendTicketPaidEmail(rawBooking) {
  try {
    // Cho phép truyền vào doc mongoose hoặc plain object
    const booking =
      rawBooking && typeof rawBooking.toObject === 'function'
        ? rawBooking.toObject()
        : rawBooking || {};

    if (!booking) {
      console.error('[MAILER] booking null/undefined');
      return;
    }

    const email = booking.customer?.email;
    if (!email) {
      console.error('[MAILER] booking.customer.email missing', {
        bookingId: booking._id,
      });
      return;
    }

    if (!process.env.RESEND_API_KEY) {
      console.error('[MAILER] RESEND_API_KEY missing – skip send');
      return;
    }

    const fromAddress = process.env.MAIL_FROM || DEFAULT_FROM;
    const html = buildTicketHtml(booking);

    console.log('[MAILER] Sending paid ticket email', {
      to: email,
      from: fromAddress,
      bookingId: booking._id,
    });

    const result = await resend.emails.send({
      from: fromAddress,
      to: email,
      subject: 'Xác nhận thanh toán vé xe thành công',
      html,
    });

    if (result.error) {
      console.error('[MAILER] Resend error:', result.error);
    } else {
      console.log('[MAILER] Email sent OK:', result.data);
    }
  } catch (err) {
    console.error(
      '[MAILER] Email send exception:',
      err?.response?.data || err?.response?.body || err
    );
  }
}

module.exports = {
  sendTicketPaidEmail,
};
