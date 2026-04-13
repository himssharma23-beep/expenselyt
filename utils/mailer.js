const nodemailer = require('nodemailer');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'expenselyt@gmail.com';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const EMAIL_FROM_NAME = process.env.SMTP_FROM_NAME || 'Expense Lite AI';

function isEmailEnabled() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function isWelcomeEmailEnabled() {
  return String(process.env.EMAIL_WELCOME_ENABLED || '').toLowerCase() === 'true';
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
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER;
  await transport.sendMail({
    from: `"${EMAIL_FROM_NAME}" <${fromAddress}>`,
    sender: fromAddress,
    to,
    replyTo,
    subject,
    html,
    text: htmlToText(html),
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

function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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
  if (!isWelcomeEmailEnabled()) return { sent: false, reason: 'welcome_email_disabled' };
  return sendMail({
    to,
    subject: 'Your Expense Lite AI account is ready',
    html: renderEmailLayout({
      preheader: 'Your account was created successfully.',
      eyebrow: 'Welcome',
      title: 'Your account is ready',
      intro: `Welcome ${name || 'there'} — your Expense Lite AI account has been created successfully.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">You can now sign in and start using your account.</p>
        <p style="margin:0;">If you did not create this account, please reply to this email.</p>
      `,
      actionLabel: 'Log In to Expense Lite AI',
      actionHref: `${APP_BASE_URL}/login`,
      secondaryHtml: '',
      featureItems: [],
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

function formatCurrency(amount, currencyCode = 'INR', localeCode = 'en-IN') {
  const value = Number(amount || 0);
  try {
    return new Intl.NumberFormat(localeCode || 'en-IN', {
      style: 'currency',
      currency: currencyCode || 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (_err) {
    return `${currencyCode || 'INR'} ${value.toFixed(2)}`;
  }
}

function formatDate(value, localeCode = 'en-IN') {
  if (!value) return '-';
  const raw = String(value).trim();
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(localeCode || 'en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch (_err) {
    return raw;
  }
}

function renderSummaryTable(rows = []) {
  if (!rows.length) return '';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:18px;margin-top:18px;">
      ${detailRows(rows)}
    </table>`;
}

async function sendSplitSharedEmail({ to, ownerName, recipientName, sessionTitle, divideDate, totalAmount, yourShare, itemCount, currencyCode, localeCode }) {
  return sendMail({
    to,
    subject: `${ownerName || 'A friend'} shared a split expense with you`,
    html: renderEmailLayout({
      preheader: 'A shared split expense is now available in your app.',
      eyebrow: 'Split Expenses',
      title: 'A split session was shared with you',
      intro: `Hi ${recipientName || 'there'}, ${ownerName || 'someone'} shared a split expense session with you in Expense Lite AI.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">You can open the Split section to view the full breakdown, who paid, and how much you owe or are owed.</p>
        ${renderSummaryTable([
          { label: 'Session', value: escapeHtml(sessionTitle || 'Split expense') },
          { label: 'Date', value: escapeHtml(formatDate(divideDate, localeCode)) },
          { label: 'Total', value: escapeHtml(formatCurrency(totalAmount, currencyCode, localeCode)) },
          { label: 'Your Share', value: escapeHtml(formatCurrency(yourShare, currencyCode, localeCode)) },
          { label: 'Items', value: escapeHtml(String(itemCount || 0)) },
        ])}
      `,
      actionLabel: 'Open Split Expenses',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Shared Split History', 'Who Owes What', 'Saved Session Details'],
    }),
  });
}

async function sendTripLinkedEmail({ to, ownerName, recipientName, tripName, startDate, permission, currencyCode, localeCode }) {
  return sendMail({
    to,
    subject: `${ownerName || 'A friend'} added you to a trip`,
    html: renderEmailLayout({
      preheader: 'You were added to a trip in Expense Lite AI.',
      eyebrow: 'Trips',
      title: 'You were added to a trip',
      intro: `Hi ${recipientName || 'there'}, ${ownerName || 'someone'} linked you to the trip "${tripName}".`,
      bodyHtml: `
        <p style="margin:0 0 16px;">The trip is now visible in your app. You can review expenses, your share, and the current permission level.</p>
        ${renderSummaryTable([
          { label: 'Trip', value: escapeHtml(tripName || '-') },
          { label: 'Start Date', value: escapeHtml(formatDate(startDate, localeCode)) },
          { label: 'Permission', value: escapeHtml(permission || 'edit') },
          { label: 'Added By', value: escapeHtml(ownerName || '-') },
        ])}
      `,
      actionLabel: 'Open Trips',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Trip Expenses', 'Shared Members', 'Settlement Summary'],
    }),
  });
}

async function sendTripFinalizedEmail({ to, recipientName, tripName, ownerName, summaryLines = [], currencyCode, localeCode }) {
  const rows = summaryLines.map((line) => ({
    label: line.label,
    value: escapeHtml(line.is_money ? formatCurrency(line.value, currencyCode, localeCode) : String(line.value)),
  }));
  return sendMail({
    to,
    subject: `Trip finalized: ${tripName}`,
    html: renderEmailLayout({
      preheader: 'A trip you were part of has been finalized.',
      eyebrow: 'Trip Finalized',
      title: 'Your trip settlement is ready',
      intro: `Hi ${recipientName || 'there'}, ${ownerName || 'someone'} finalized the trip "${tripName}".`,
      bodyHtml: `
        <p style="margin:0 0 16px;">You can review the final totals and settlement details inside the app. A quick summary is below.</p>
        ${renderSummaryTable(rows)}
      `,
      actionLabel: 'Open Trip Details',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Final Settlement', 'Expense Breakdown', 'Your Share'],
    }),
  });
}

async function sendMonthlyPlannerSummaryEmail({ to, name, monthLabel, currentDue, projectedDue, bankBalance, spendable, afterAll, currencyCode, localeCode }) {
  return sendMail({
    to,
    subject: `${monthLabel} planner summary`,
    html: renderEmailLayout({
      preheader: `Your ${monthLabel} planner totals are ready.`,
      eyebrow: 'Monthly Planner',
      title: `${monthLabel} planner summary`,
      intro: `Hi ${name || 'there'}, here is your planner summary for ${monthLabel}.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">This snapshot shows what is due this month, your projected due position, and how your bank balance stands before and after dues.</p>
        ${renderSummaryTable([
          { label: 'Current Due', value: escapeHtml(formatCurrency(currentDue, currencyCode, localeCode)) },
          { label: 'Projected Due', value: escapeHtml(formatCurrency(projectedDue, currencyCode, localeCode)) },
          { label: 'Bank Balance', value: escapeHtml(formatCurrency(bankBalance, currencyCode, localeCode)) },
          { label: 'Bank Spendable', value: escapeHtml(formatCurrency(spendable, currencyCode, localeCode)) },
          { label: 'After All Dues', value: escapeHtml(formatCurrency(afterAll, currencyCode, localeCode)) },
        ])}
      `,
      actionLabel: 'Open Planner',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Monthly Dues', 'Projected Payments', 'Bank Position'],
    }),
  });
}

async function sendTrackerMonthSummaryEmail({ to, name, trackerName, monthLabel, totalAmount, totalQty, autoDays, editedDays, expenseMonthLabel, currencyCode, localeCode }) {
  return sendMail({
    to,
    subject: `${trackerName} summary for ${monthLabel}`,
    html: renderEmailLayout({
      preheader: `Your daily tracker summary for ${monthLabel} is ready.`,
      eyebrow: 'Daily Tracker',
      title: `${trackerName} summary`,
      intro: `Hi ${name || 'there'}, here is your ${trackerName} tracker summary for ${monthLabel}.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">This tracker total can also flow into planner or expenses depending on your settings.</p>
        ${renderSummaryTable([
          { label: 'Tracker Month', value: escapeHtml(monthLabel) },
          { label: 'Total Amount', value: escapeHtml(formatCurrency(totalAmount, currencyCode, localeCode)) },
          { label: 'Total Quantity', value: escapeHtml(String(totalQty || 0)) },
          { label: 'Auto-filled Days', value: escapeHtml(String(autoDays || 0)) },
          { label: 'Edited Days', value: escapeHtml(String(editedDays || 0)) },
          { label: 'Applied To', value: escapeHtml(expenseMonthLabel || 'Planner / Expense based on settings') },
        ])}
      `,
      actionLabel: 'Open Daily Tracker',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Monthly Totals', 'Auto-filled Days', 'Expense Carry Forward'],
    }),
  });
}

async function sendRecurringAppliedEmail({ to, name, monthLabel, entries = [], currencyCode, localeCode }) {
  return sendMail({
    to,
    subject: `Recurring amounts applied for ${monthLabel}`,
    html: renderEmailLayout({
      preheader: `Recurring amounts were added for ${monthLabel}.`,
      eyebrow: 'Recurring',
      title: `Recurring amounts added for ${monthLabel}`,
      intro: `Hi ${name || 'there'}, these recurring amounts were added for ${monthLabel}.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">The following recurring entries were applied to this month.</p>
        ${renderSummaryTable(entries.map((entry) => ({
          label: entry.label,
          value: escapeHtml(formatCurrency(entry.amount, currencyCode, localeCode)),
        })))}
      `,
      actionLabel: 'Open Recurring',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Recurring Expenses', 'Monthly Application', 'Expense Sync'],
    }),
  });
}

async function sendTrackerExpenseAppliedEmail({ to, name, trackerName, sourceMonthLabel, expenseMonthLabel, amount, currencyCode, localeCode }) {
  return sendMail({
    to,
    subject: `${trackerName} added to expenses`,
    html: renderEmailLayout({
      preheader: `${trackerName} was added to expenses.`,
      eyebrow: 'Daily Tracker',
      title: 'Tracker total added to expenses',
      intro: `Hi ${name || 'there'}, your ${trackerName} tracker total was added to expenses.`,
      bodyHtml: `
        ${renderSummaryTable([
          { label: 'Tracker', value: escapeHtml(trackerName) },
          { label: 'Source Month', value: escapeHtml(sourceMonthLabel) },
          { label: 'Expense Month', value: escapeHtml(expenseMonthLabel) },
          { label: 'Amount', value: escapeHtml(formatCurrency(amount, currencyCode, localeCode)) },
        ])}
      `,
      actionLabel: 'Open Expenses',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Tracker to Expense', 'Monthly Carry Forward'],
    }),
  });
}

async function sendLiveSplitInviteEmail({ to, inviterName, inviteLink }) {
  return sendMail({
    to,
    subject: `${inviterName || 'A friend'} invited you to Live Split`,
    html: renderEmailLayout({
      preheader: `${inviterName || 'A friend'} invited you to split expenses on Expense Lite AI.`,
      eyebrow: 'Live Split Invite',
      title: 'You are invited to Live Split',
      intro: `${inviterName || 'A friend'} invited you to join Live Split on Expense Lite AI.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">Create your account (or sign in) to see and manage shared Live Split balances.</p>
      `,
      actionLabel: 'Open Invite',
      actionHref: inviteLink || `${APP_BASE_URL}/register`,
      secondaryHtml: `
        <p style="margin:14px 0 0;font-size:13px;color:#64748B;">If button does not open, use this link:</p>
        <div style="padding:12px 14px;border-radius:14px;background:#F8FAFC;border:1px solid #E2E8F0;word-break:break-all;font-size:13px;color:#145A3C;">
          ${escapeHtml(inviteLink || `${APP_BASE_URL}/register`)}
        </div>
      `,
      featureItems: ['Split Expenses', 'Live Balances', 'Shared History'],
    }),
  });
}

async function sendLiveSplitTripCreatedEmail({ to, ownerName, recipientName, tripName, startDate, endDate, currencyCode = 'INR', localeCode = 'en-IN' }) {
  return sendMail({
    to,
    subject: `${ownerName || 'A friend'} created a Live Split trip with you`,
    html: renderEmailLayout({
      preheader: `${ownerName || 'A friend'} created a Live Split trip and added you.`,
      eyebrow: 'Live Split Trip',
      title: 'You were added to a Live Split trip',
      intro: `Hi ${recipientName || 'there'}, ${ownerName || 'someone'} created the trip "${tripName || 'Trip'}" with you.`,
      bodyHtml: `
        <p style="margin:0 0 16px;">Open Live Split to view the trip, members, and shared expenses.</p>
        ${renderSummaryTable([
          { label: 'Trip', value: escapeHtml(tripName || '-') },
          { label: 'Start Date', value: escapeHtml(startDate || '-') },
          { label: 'End Date', value: escapeHtml(endDate || startDate || '-') },
        ])}
      `,
      actionLabel: 'Open Live Split',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Trip Expenses', 'Member Shares', 'Real-time Balances'],
    }),
  });
}

async function sendLiveSplitMonthlySummaryEmail({ to, name, month, oweToMe = 0, iOwe = 0, net = 0, topRows = [], currencyCode = 'INR', localeCode = 'en-IN' }) {
  const [year, mon] = String(month || '').split('-').map(Number);
  const monthDate = year && mon ? new Date(year, mon - 1, 1) : new Date();
  const monthLabel = monthDate.toLocaleDateString(localeCode || 'en-IN', { month: 'long', year: 'numeric' });
  const rows = (topRows || []).slice(0, 5).map((row) => {
    const amount = Number(Math.abs(Number(row?.amount || 0)).toFixed(2));
    const status = Number(row?.amount || 0) > 0 ? 'owes you' : Number(row?.amount || 0) < 0 ? 'you owe' : 'settled';
    return `<li style="margin:0 0 6px;color:#334155;">${escapeHtml(String(row?.name || 'Friend'))} - ${escapeHtml(status)} ${escapeHtml(formatCurrency(amount, currencyCode, localeCode))}</li>`;
  }).join('');
  return sendMail({
    to,
    subject: `${monthLabel} Live Split summary`,
    html: renderEmailLayout({
      preheader: `Your Live Split monthly balance summary for ${monthLabel}.`,
      eyebrow: 'Live Split',
      title: `${monthLabel} balance summary`,
      intro: `Hi ${name || 'there'}, here is your current Live Split summary.`,
      bodyHtml: `
        ${renderSummaryTable([
          { label: 'People owe you', value: escapeHtml(formatCurrency(oweToMe, currencyCode, localeCode)) },
          { label: 'You owe others', value: escapeHtml(formatCurrency(iOwe, currencyCode, localeCode)) },
          { label: 'Net balance', value: escapeHtml(formatCurrency(net, currencyCode, localeCode)) },
        ])}
        ${rows ? `<div style="margin-top:16px;font-size:13px;color:#334155;font-weight:700;">Top balances</div><ul style="padding-left:18px;margin:8px 0 0;">${rows}</ul>` : ''}
      `,
      actionLabel: 'Open Live Split',
      actionHref: `${APP_BASE_URL}/`,
      featureItems: ['Who owes whom', 'Net position', 'Live split history'],
    }),
  });
}

module.exports = {
  ADMIN_EMAIL,
  isEmailEnabled,
  isWelcomeEmailEnabled,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendAdminNewUserEmail,
  sendPhoneLoginHelpEmail,
  sendContactEmail,
  sendContactAckEmail,
  sendSplitSharedEmail,
  sendTripLinkedEmail,
  sendTripFinalizedEmail,
  sendMonthlyPlannerSummaryEmail,
  sendTrackerMonthSummaryEmail,
  sendRecurringAppliedEmail,
  sendTrackerExpenseAppliedEmail,
  sendLiveSplitInviteEmail,
  sendLiveSplitTripCreatedEmail,
  sendLiveSplitMonthlySummaryEmail,
};
