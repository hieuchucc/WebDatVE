require('dotenv').config();
const nodemailer = require('nodemailer');

(async () => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE||'false') === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: 'hieuchucc91@gmail.com', 
    subject: ' T1 hận hạnh chiêu mộ Achu Achit ',
    html: '<h3>Xin chào! Gumayusi FMVP muốn chiêu mộ bạn về làm ad dự bị 🎉</h3>'
  });

  console.log('✅ Gửi email thành công!')
})();
