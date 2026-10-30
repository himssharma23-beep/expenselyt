# Transaction capture

Implemented in the web/backend and Expo mobile repositories. Existing manually entered expenses remain unchanged. New capture methods are disabled for every account, including administrators, until explicitly granted.

## Compatibility when new features are disabled

The existing `/api/auth/me/access` and `/api/smart-capture/parse-ai` handlers retain their original behaviour. New capture permission checks do not apply to the existing manual AI parser. Core account/page access never queries or migrates capture tables. Optional capture availability is discovered separately through a read-only `/api/capture/access` request; missing tables, database permissions or discovery failures leave the new feature hidden without blocking sign-in or existing pages.

The mobile app preserves the original local inbox, parser and offline create/edit/ignore/delete operations. Existing local suggestions are always listed, never automatically uploaded, migrated or removed. Server suggestions have separate `server:` UI IDs and are fetched only for accounts granted new methods; server failures fall back to showing local suggestions. Legacy manual/clipboard/AI flows retain their original page access. New permissions govern the added server workflow. Existing device-local Android notification settings and pre-upgrade plain-JSON queues are preserved separately from server capture; disabling server capture does not disable legacy notification capture.

Users with no new grants see no new method settings or permission prompts. The release configuration omits the new Android SMS permission by default. Granting server features does not silently change, move or upload historical local records.

## Admin and user setup

1. Open **Admin → Users → Capture permissions** on web or mobile.
2. Select the individual user's methods. Grants cover typed text, clipboard text, Android notifications, Android SMS, iPhone Shortcuts, Gmail, Outlook, forwarded email, receipt/screenshot OCR, statements, voice, AI reading, and automatic saving.
3. The user opens **More → Smart Capture** on mobile or **Smart Capture** on web and enables their granted methods. An admin grant does not grant operating-system or mailbox access.
4. Enable AI reading separately if desired. It uses the existing server OpenAI configuration. Voice requires both Voice and AI reading grants and consent.

Revoking a method resets its user preference, deletes its submission tokens and, for Gmail/Outlook, removes stored mailbox credentials. Changes are recorded in `transaction_capture_audit`. Permissions are checked at ingestion and when confirming a suggestion. User IDs always come from authenticated sessions or hashed submission tokens, never a submitted user ID.

## Deployment

The backend needs the existing PostgreSQL schema. Capture tables are not required for existing features. Apply the optional schema using `node scripts/migrate-postgres.js --capture`, or have an operator apply `db/transaction-capture.sql` before enabling capture. The normal migration without `--capture` is unchanged. Explicit capture configuration endpoints can also initialise these additional tables if the database role permits DDL; read-only availability discovery never does. No existing records are backfilled or emailed.

Set `APP_BASE_URL` to the HTTPS public backend URL. Rebuild the mobile binaries after installing the native plugin changes. Native templates live in `native/smartcapture` and the config plugin regenerates Android classes, permissions and registration during Expo prebuild/EAS builds; ignored local `android/` edits are not the source of truth.

### Android

For the new server workflow, users select allowed banking/payment apps from their installed app list and grant Notification Access in Android settings. No apps are selected by default. SMS capture receives new transactional messages and does not scan historical SMS. OTP messages are excluded. `enableSms` in `app.json` defaults to false, omitting the new SMS permission and receiver from the release manifest. A separately configured SMS-enabled build requests `RECEIVE_SMS`. Google Play approval is required for restricted SMS access under the money-management exception; approval cannot be supplied by an app administrator.

New server capture uses Android Keystore encryption for scoped submission tokens and the pending queue. New alerts attempt HTTPS submission in the background. Network failures remain queued for the next alert or app-open import, up to 200 messages. Android battery restrictions, hidden notification content and disabled notification access can prevent capture; this is not guaranteed delivery. No historical notification access is provided. Switching accounts or logging out clears server-owned queue entries and credentials while preserving the pre-existing local notification mode and ownerless legacy queue. Admin revocation is enforced for server capture even if a device is offline.

### iPhone

Enable Shortcuts capture, generate its setup details, and create a user-owned Apple Shortcuts automation. Use a Message trigger matching bank messages; use a Notification trigger where supported (iOS 27), or a Wallet transaction trigger where transaction details are available. Add **Get Contents of URL** with the generated HTTPS endpoint:

```http
POST /api/capture/shortcut
Authorization: Bearer <generated-scoped-token>
Content-Type: application/json

{"text":"<available transaction text from Shortcut Input>","ai":false}
```

Set `ai:true` only after granting and enabling AI reading. A token can submit captures only; it cannot read the inbox or create arbitrary expenses. Creating a new token revokes the previous token. Personal automations must be configured by the user; the app cannot silently configure them. Validate the exact supplied transaction fields and locked-device behaviour on each supported iOS version. Receipt/screenshot selection, camera, statements, email and voice work in the shared React Native interface. A native iOS SMS inbox reader, background notification listener, App Intent extension, Share extension and FinanceKit bank sync have not been added. Use Shortcuts' HTTP action and in-app file selection for those supported import paths. FinanceKit needs an Apple entitlement, supported accounts and regional availability and cannot provide universal Indian bank/UPI coverage.

### Gmail and Outlook

Create OAuth registrations owned by your service and configure:

```dotenv
APP_BASE_URL=https://your-public-app.example
CAPTURE_TOKEN_ENCRYPTION_KEY=<32 random bytes, base64 encoded>
CAPTURE_GOOGLE_CLIENT_ID=<Google web OAuth client ID>
CAPTURE_GOOGLE_CLIENT_SECRET=<Google client secret>
CAPTURE_MICROSOFT_CLIENT_ID=<Microsoft application ID>
CAPTURE_MICROSOFT_CLIENT_SECRET=<Microsoft client secret>
CAPTURE_EMAIL_WORKER_ENABLED=true
```

Register these exact redirect URLs:

- `https://your-public-app.example/api/capture/email/callback/email_gmail`
- `https://your-public-app.example/api/capture/email/callback/email_outlook`

Gmail uses `gmail.readonly`, which requires Google's applicable restricted-scope verification/security assessment for production server processing. Outlook uses delegated `Mail.Read`, `User.Read` and offline access; tenant policies may require administrator consent. Request no sending or mailbox modification permission. Read permission remains broader than the exact sender list: filtering constrains processing, not the OAuth grant.

The user enters exact bank/receipt sender email addresses before connecting. OAuth uses one-time, expiring state and PKCE. Refresh tokens and the sender list are AES-256-GCM encrypted in PostgreSQL using the configured independent key. Keep that key stable and backed up; losing it requires users to reconnect. Never commit keys or tokens.

Manual sync processes a page of up to 50 recent messages; run again while `has_more` is true. The opt-in worker polls every two minutes, up to 100 mailbox connections per cycle, ordered by oldest sync. It scans the last 30 days. This is polling, not provider push. Disconnect deletes local credentials; users can also revoke the app at Google/Microsoft. Email delivery is not comprehensive transaction coverage.

### Forwarded email

Configure a real inbound-email service/domain first:

```dotenv
CAPTURE_INBOUND_DOMAIN=inbound.your-public-app.example
CAPTURE_INBOUND_WEBHOOK_SECRET=<independent random secret, at least 32 characters>
```

The user generates a private `capture+<token>@<domain>` address and configures a forwarding rule for their transaction alerts. Your inbound service adapter must authenticate/verify the provider webhook, enforce provider email authentication/spam controls, resolve the actual recipient, convert MIME to plain text, and send this normalized request over HTTPS:

```http
POST /api/capture/email/inbound
Authorization: Bearer <CAPTURE_INBOUND_WEBHOOK_SECRET>
Content-Type: application/json

{"recipient":"capture+<token>@<domain>","subject":"Bank transaction","text":"INR 350 debited at Merchant on 2026-10-27. UTR 1234567890","message_id":"provider-stable-id"}
```

The implementation supplies the authenticated normalized ingestion endpoint, not DNS, an SMTP listener or a vendor-specific inbound adapter. Treat forwarding addresses as private submission capabilities; never include them in public logs. The global gateway secret and recipient token are both required.

## Review, files and AI

The server inbox is user-scoped. The previous local AsyncStorage inbox remains on the device and stays visible alongside it; it is never automatically imported into a user account. Manual text and clipboard have separate grants for the new server workflow, while the legacy local flows remain available under their existing access rules. Receipt images use local server OCR when AI reading is disabled; enabling AI uses the existing vision parser. Voice uses the existing transcription/parser configuration. Supported statement files are CSV, XLSX/XLS and text-based PDF, at most 200 candidate rows; encrypted PDFs require a password supplied through the API. Scanned PDF OCR is not implemented. CSV/Excel expected columns: `date`, `description`, `debit`/`credit` or `amount` plus `type`/`direction`, optional `currency`, `reference`/`utr`. Rows without an explicit debit/credit direction require expense confirmation. Unsupported or unreadable rows are reported, never automatically converted into invented transactions.

AI is used only with the user's grant and preference. Account-number-like strings and OTP content are filtered before text AI processing. Receipt images/audio may themselves contain sensitive information and are sent to the configured provider when those AI features are used. Structured results are treated as suggestions; a deterministic classification prevents AI from turning an identified credit/refund/transfer/failed payment into spending.

Stable transaction references deduplicate alerts across sources. Source event IDs/text hashes deduplicate retries. Similar merchant/amount/date matches are flagged as possible duplicates rather than discarded, because equal legitimate purchases can exist. Reference-free duplicates and merchant variations require human reconciliation.

Confirming a capture atomically creates an expense, optional linked credit-card transaction, bank balance change where selected, and the capture status. Retrying confirmation returns the original expense ID. Auto-save is separately granted and enabled and requires a debit, amount, explicit date, confidence at least 95, reference and matched bank; credit-card captures and possible duplicates remain in review. Rules-only extraction is intentionally below this threshold. A currency that differs from the account currency requires manual conversion. Refunds, credits, transfers and failed/pending transactions cannot be posted through the expense confirmation endpoint. Deleting a processed capture does not delete its linked expense.

## Validation

Mobile compatibility checks: run `node --test tests/captureCompatibility.test.cjs` in the mobile repository. These cover preserving local records and offline operations, separating local/server IDs, legacy Android queue imports, denied server imports, and non-blocking capture availability discovery during normal access loading.

Run `npm run build` and `node --test tests/transaction-capture.test.js` in the web repository. `node tests/transaction-capture-ui.cjs` checks the web interface in headless Chrome; set `CAPTURE_TEST_BROWSER` to your installed Chromium browser path if needed. Backend tests use mocked database/provider boundaries and include real HTTP route authorization checks. Android and iOS Expo bundles, Expo Android plugin introspection and Android Kotlin compilation have passed locally. Before release, verify real bank notifications/SMS, provider OAuth, sender filtering, mailbox disconnect/revocation, iPhone locked-device automations, offline retries, account switching, and duplicate confirmation on devices and a staging database. Credentials, provider review, DNS setup and signed iOS builds are external deployment steps.
