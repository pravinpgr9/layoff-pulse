# Layoff Pulse — Vercel deployment

A responsive anonymous survey frontend with:
- a success toast on successful API submission
- a dedicated `public/success.html` confirmation page
- a Vercel serverless API at `/api/survey`
- MongoDB Atlas persistence
- optional email notifications containing all supported survey fields

## Project structure

```text
layoff-pulse-vercel/
├── api/
│   └── survey.js
├── public/
│   ├── index.html
│   └── success.html
├── .env.example
├── package.json
├── vercel.json
└── README.md
```

## 1. Set up MongoDB Atlas

1. Create a MongoDB Atlas project and database user.
2. In Network Access, allow connections from your deployment environment. For a quick test, Atlas offers `0.0.0.0/0`, but that permits attempts from any IP and should be paired with a strong database password. Prefer a restricted network setup where practical.
3. Copy the Atlas connection string and replace the username/password placeholders.
4. The API creates the `layoff_pulse` database and `survey_responses` collection on first insert.

The database document stores:
- `survey`
- `schemaVersion`
- `submittedAt`
- `responses` (the survey fields)

It does not collect name, email, or employer name. MongoDB itself and Vercel may still process operational metadata such as connection logs; do not promise absolute anonymity.

## 2. Configure email notifications with Resend

Email is optional. If configured, each new submission sends a notification with every survey field, including fields that were left unanswered (shown as “Not answered”).

1. Create a Resend account and API key.
2. Verify a domain/sender address in Resend.
3. Set `RESEND_API_KEY`, `SURVEY_NOTIFICATION_EMAIL`, and `EMAIL_FROM`.
4. Use a sender address on a domain verified in Resend. Do not use an arbitrary Gmail address as `EMAIL_FROM` unless the provider explicitly supports it.

A notification failure does not undo the database insert. Check Vercel Function Logs and Resend logs for delivery issues.

## 3. Deploy to Vercel

### Option A — GitHub (recommended)

1. Extract this ZIP.
2. Create a new GitHub repository and upload all files/folders from this project.
3. Import that repository in Vercel.
4. In Vercel → Project → Settings → Environment Variables, add:
   - `MONGODB_URI`
   - `MONGODB_DB_NAME` = `layoff_pulse` (optional)
   - `MONGODB_COLLECTION_NAME` = `survey_responses` (optional)
   - `RESEND_API_KEY` (optional)
   - `SURVEY_NOTIFICATION_EMAIL` (optional)
   - `EMAIL_FROM` (optional)
5. Deploy. Redeploy after changing environment variables.
6. Open the deployed domain and submit a test response. Confirm a document appears in Atlas and check the notification email if configured.

### Option B — Vercel CLI

Install Node.js 20+ and run from the project directory:

```bash
npm install
npx vercel login
npx vercel
```

Follow the prompts. Add environment variables in the Vercel dashboard or with `npx vercel env add`, then deploy production with:

```bash
npx vercel --prod
```

For local testing, copy `.env.example` to `.env.local`, fill in values, and run:

```bash
npm install
npm run dev
```

Never commit `.env.local` or real API keys.

## 4. How submission works

The browser sends a JSON `POST` to `/api/survey`. The API validates required fields, whitelists accepted survey keys, limits free-text length, stores the response, and attempts to send the email notification. On success, the browser displays a toast and redirects to `/success.html`.

The response is anonymous in the sense that the form does not request direct identifiers. Free-text answers can accidentally identify a person, so the UI asks respondents not to include names or confidential information.

## 5. Important production checklist

- Publish a clear privacy notice stating purpose, data stored, retention period, contact, and who can access responses.
- Restrict MongoDB access to the least-privileged database user.
- Keep all secrets in Vercel environment variables.
- Add abuse protection/rate limiting before public promotion (e.g., a managed rate-limit service or CAPTCHA). Serverless in-memory counters are not reliable across instances.
- Decide a retention/deletion policy for raw survey responses.
- Test on mobile and submit test values for every multi-select and free-text field.
- Treat findings as respondent-reported data, not a representative estimate of all layoffs.
