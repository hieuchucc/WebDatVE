const express = require('express');
const router = express.Router();

let Resend;
try {
  Resend = require('resend').Resend;
} catch (e) {
  console.error('[TEST] Cannot require resend:', e && e.message);
}

router.get('/_test-resend', async (req, res) => {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.warn('[TEST] No RESEND_API_KEY in env');
      return res.status(500).send('No RESEND_API_KEY in env');
    }
    if (!Resend) {
      return res.status(500).send('Resend module missing');
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.MAIL_FROM || 'onboarding@resend.dev';
    const to = req.query.to || 'yourtestemail@example.com';

    console.log('[TEST] RESEND: sending from', from, 'to', to);

    const result = await resend.emails.send({
      from,
      to,
      subject: 'Test email from Resend route',
      html: `<p>Test at ${new Date().toISOString()}</p>`,
    });

    console.log('[TEST] RESEND RESULT:', result);
    return res.json({ ok: true, result });
  } catch (err) {
    console.error('[TEST] RESEND ERROR:', err && (err.response || err.message || err));
    if (err && err.response && err.response.body) {
      console.error('[TEST] RESEND ERROR BODY:', err.response.body);
    }
    return res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

module.exports = router;