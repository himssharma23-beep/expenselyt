const nodemailer = require('nodemailer');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'expenselyt@gmail.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

function isEmailEnabled() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransport() {
  if (!isEmailEnabled()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail({ to, subject, html, replyTo }) {
  const transport = getTransport();
  if (!transport) return { sent: false, reason: 'email_not_configured' };
  await transport.sendMail({
    from: process.env.SMTP_FROM || `"Expense Lite AI" <${process.env.SMTP_USER}>`,
    to,
    replyTo,
    subject,
    html,
  });
  return { sent: true };
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function featurePills(items) {
  return items.map((item) => `
    <span style="display:inline-block;margin:0 8px 8px 0;padding:7px 12px;border-radius:999px;background:#E8F5EE;color:#145A3C;font-size:12px;font-weight:700;">
      ${escapeHtml(item)}
    </span>
  `).join('');
}

function detailRows(rows) {
  return rows.map(({ label, value }) => `
    <tr>
      <td style="padding:8px 14px 8px 0;font-size:13px;font-weight:700;color:#475569;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;font-size:14px;color:#0F172A;">${value}</td>
    </tr>
  `).join('');
}

function renderEmailLayout({
  preheader = '',
  eyebrow = 'Expense Lite AI',
  title,
  intro,
  bodyHtml = '',
  actionLabel = '',
  actionHref = '',
  secondaryHtml = '',
  featureIntro = '',
  featureItems = [],
}) {
  const actionBlock = actionLabel && actionHref
    ? `<div style="margin:28px 0 8px">
         <a href="${escapeHtml(actionHref)}" style="display:inline-block;background:#145A3C;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:14px;font-size:14px;font-weight:800;letter-spacing:0.01em;">
           ${escapeHtml(actionLabel)}
         </a>
       </div>`
    : '';

  const featuresBlock = featureItems.length
    ? `<div style="margin-top:28px;padding-top:24px;border-top:1px solid #E2E8F0">
         <div style="font-size:13px;font-weight:800;color:#145A3C;margin-bottom:10px;letter-spacing:0.04em;text-transform:uppercase;">Why people use Expense Lite AI</div>
         ${featureIntro ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#475569">${escapeHtml(featureIntro)}</p>` : ''}
         <div>${featurePills(featureItems)}</div>
       </div>`
    : '';

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#F4F7F9;font-family:Arial,sans-serif;color:#0F172A;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || intro || title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F4F7F9" style="background:#F4F7F9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;">
            <tr>
              <td style="padding-bottom:18px;text-align:center;">
                <div style="display:inline-block;padding:8px 16px;border-radius:999px;background:#0D3D27;color:#ffffff;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">
                  ${escapeHtml(eyebrow)}
                </div>
              </td>
            </tr>
            <tr>
              <td bgcolor="#145A3C" style="background:#145A3C;border-radius:28px 28px 0 0;padding:34px 34px 28px;color:#ffffff;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.72;margin-bottom:12px;">Track · Plan · Ask AI</div>
                <div style="font-size:32px;line-height:1.15;font-weight:800;letter-spacing:-0.03em;margin:0 0 12px;color:#FFFFFF;">${escapeHtml(title)}</div>
                <div style="font-size:15px;line-height:1.8;color:#F3FBF6;max-width:520px;">${escapeHtml(intro)}</div>
              </td>
            </tr>
            <tr>
              <td bgcolor="#FFFFFF" style="background:#ffffff;border-radius:0 0 28px 28px;padding:32px 34px;">
                <div style="font-size:15px;line-height:1.8;color:#334155;">${bodyHtml}</div>
                ${actionBlock}
                ${secondaryHtml}
                ${featuresBlock}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 18px 4px;text-align:center;font-size:12px;line-height:1.7;color:#64748B;">
                Expense Lite AI helps you manage expenses, loans, EMIs, planner dues, split spending, accounts, and AI lookup in one place.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

async function sendPasswordResetEmail({ to, name, resetLink, resetCode }) {
  return sendMail({
    to,
    subject: 'Reset your Expense Lite AI password',
    html: renderEmailLayout({
      preheader: 'Your password reset code is inside. This request expires in 10 minutes.',
      eyebrow: 'Password Reset',
      title: 'Reset your password securely',
      intro: `Hi ${name || 'there'}, we received a request to reset your Expense Lite AI password.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">Use this one-time reset code to set a new password:</p>
        <div style="margin:0 0 20px;padding:18px 20px;border-radius:20px;background:#F8FAFC;border:1px solid #E2E8F0;text-align:center;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748B;margin-bottom:8px;">Reset Code</div>
          <div style="font-size:34px;font-weight:900;letter-spacing:8px;color:#145A3C;">${escapeHtml(resetCode || '')}</div>
          <div style="margin-top:10px;font-size:13px;color:#64748B;">This code expires in 10 minutes.</div>
        </div>
        <p style="margin:0 0 14px;">You can also use the secure reset page if that is easier:</p>
      `,
      actionLabel: 'Open Reset Page',
      actionHref: resetLink,
      secondaryHtml: `
        <p style="margin:18px 0 8px;font-size:13px;color:#64748B;">If the button does not work, copy and open this link:</p>
        <div style="padding:14px 16px;border-radius:16px;background:#F8FAFC;border:1px solid #E2E8F0;word-break:break-all;font-size:13px;color:#145A3C;">
          ${escapeHtml(resetLink)}
        </div>
        <p style="margin:18px 0 0;font-size:13px;color:#64748B;">If you did not request this, you can safely ignore this email.</p>
      `,
      featureIntro: 'Once you are back in, you can pick up right where you left off.',
      featureItems: ['Expense Tracking', 'Monthly Planner', 'Loan & EMI Management', 'AI Lookup'],
    }),
  });
}

async function sendWelcomeEmail({ to, name }) {
  return sendMail({
    to,
    subject: 'Welcome to Expense Lite AI',
    html: renderEmailLayout({
      preheader: 'Your account is ready. Start tracking expenses, loans, EMIs, and planner dues.',
      eyebrow: 'Welcome',
      title: 'Your finance workspace is ready',
      intro: `Welcome ${name || 'there'} — your Expense Lite AI account has been created successfully.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">You now have one place to track spending, manage loans and EMIs, stay ahead of monthly dues, and keep bank accounts and credit cards organised.</p>
        <p style="margin:0;">You can also use AI Lookup to ask plain-English questions about your finances and get fast answers from your own data.</p>
      `,
      actionLabel: 'Log In to Expense Lite AI',
      actionHref: `${APP_BASE_URL}/login`,
      secondaryHtml: `
        <div style="margin-top:22px;padding:18px 20px;border-radius:20px;background:#F8FAFC;border:1px solid #E2E8F0;">
          <div style="font-size:13px;font-weight:800;color:#145A3C;margin-bottom:8px;">A good first setup</div>
          <div style="font-size:14px;line-height:1.8;color:#475569;">Add your first expenses, set up your bank accounts or cards, and review your profile settings so your currency and contact details are correct from day one.</div>
        </div>
      `,
      featureIntro: 'A few things you can do right away:',
      featureItems: ['Expenses & Reports', 'Friends & Split Bills', 'Planner & Recurring Dues', 'Banks, Cards, and AI Lookup'],
    }),
  });
}

async function sendAdminNewUserEmail({ user }) {
  return sendMail({
    to: ADMIN_EMAIL,
    replyTo: user.email || undefined,
    subject: `New user joined: ${user.display_name || user.username}`,
    html: renderEmailLayout({
      preheader: 'A new user has signed up for Expense Lite AI.',
      eyebrow: 'Admin Alert',
      title: 'A new user just joined',
      intro: 'Someone created a new account in Expense Lite AI.',
      bodyHtml: `
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:18px;padding:14px 16px;">
          ${detailRows([
            { label: 'Name', value: escapeHtml(user.display_name) },
            { label: 'Username', value: escapeHtml(user.username) },
            { label: 'Email', value: escapeHtml(user.email) },
          ])}
        </table>
      `,
      secondaryHtml: `
        <p style="margin:18px 0 0;font-size:13px;color:#64748B;">You can review plans, subscriptions, OTPs, and access controls from the Admin panel.</p>
      `,
      featureItems: ['Plan Assignment', 'Subscriptions', 'User Access', 'Password Reset Links'],
    }),
  });
}

async function sendPhoneLoginHelpEmail({ phone, email, name, note }) {
  return sendMail({
    to: ADMIN_EMAIL,
    replyTo: email || undefined,
    subject: `Phone login help request${name ? `: ${name}` : ''}`,
    html: renderEmailLayout({
      preheader: 'A user needs help because they sign in with a phone number and do not know the password.',
      eyebrow: 'Support Request',
      title: 'Phone login help requested',
      intro: 'A user asked for help because they normally log in with a phone number and need their email linked or password recovery enabled.',
      bodyHtml: `
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:18px;padding:14px 16px;">
          ${detailRows([
            { label: 'Name', value: escapeHtml(name || '-') },
            { label: 'Phone', value: escapeHtml(phone || '-') },
            { label: 'Email', value: escapeHtml(email || '-') },
            { label: 'Note', value: `<div style="white-space:pre-wrap">${escapeHtml(note || '-')}</div>` },
          ])}
        </table>
      `,
      secondaryHtml: `
        <p style="margin:18px 0 0;font-size:13px;color:#64748B;">Reply to this email to continue the conversation with the user.</p>
      `,
      featureItems: ['Email Linking', 'Password Recovery', 'Account Activation'],
    }),
  });
}

async function sendContactEmail({ name, email, subject, message }) {
  return sendMail({
    to: ADMIN_EMAIL,
    replyTo: email,
    subject: `Contact form: ${subject}`,
    html: renderEmailLayout({
      preheader: `New contact message from ${name}.`,
      eyebrow: 'Contact Form',
      title: subject,
      intro: 'A new message was submitted from the Expense Lite AI contact page.',
      bodyHtml: `
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:18px;padding:14px 16px;">
          ${detailRows([
            { label: 'Name', value: escapeHtml(name) },
            { label: 'Email', value: escapeHtml(email) },
            { label: 'Subject', value: escapeHtml(subject) },
          ])}
        </table>
        <div style="margin-top:18px;padding:18px 20px;border-radius:20px;background:#F8FAFC;border:1px solid #E2E8F0;">
          <div style="font-size:13px;font-weight:800;color:#145A3C;margin-bottom:8px;">Message</div>
          <div style="font-size:14px;line-height:1.8;color:#334155;white-space:pre-wrap">${escapeHtml(message)}</div>
        </div>
      `,
      secondaryHtml: `
        <p style="margin:18px 0 0;font-size:13px;color:#64748B;">You can reply directly to this email to answer the user.</p>
      `,
    }),
  });
}

async function sendContactAckEmail({ to, name, subject }) {
  return sendMail({
    to,
    subject: 'We received your message',
    html: renderEmailLayout({
      preheader: 'Thanks for contacting Expense Lite AI. We have your message.',
      eyebrow: 'Support Received',
      title: 'Thanks for reaching out',
      intro: `Hi ${name || 'there'}, we received your message and it has been sent to the Expense Lite AI admin team.`,
      bodyHtml: `
        <div style="padding:18px 20px;border-radius:20px;background:#F8FAFC;border:1px solid #E2E8F0;">
          <div style="font-size:13px;font-weight:800;color:#145A3C;margin-bottom:8px;">Your subject</div>
          <div style="font-size:15px;font-weight:700;color:#0F172A;">${escapeHtml(subject)}</div>
        </div>
        <p style="margin:18px 0 0;">We usually reply within 1 to 3 business days. If your message is account-related, keeping the same email thread helps us respond faster.</p>
      `,
      featureIntro: 'While you wait, you can continue using Expense Lite AI to stay on top of:',
      featureItems: ['Expenses', 'Loans & EMIs', 'Monthly Planner', 'Reports & AI Lookup'],
    }),
  });
}

module.exports = {
  ADMIN_EMAIL,
  isEmailEnabled,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendAdminNewUserEmail,
  sendPhoneLoginHelpEmail,
  sendContactEmail,
  sendContactAckEmail,
};
