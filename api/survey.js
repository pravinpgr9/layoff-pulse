const { MongoClient } = require('mongodb');
const { Resend } = require('resend');

const ALLOWED_FIELDS = new Set([
  'situation', 'industry', 'experience', 'statedReason', 'mainReason',
  'aiImpact', 'warning', 'affected', 'signs', 'region', 'impact',
  'suggestion', 'anythingElse'
]);
const MAX_TEXT_LENGTH = 1200;
let clientPromise;

function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      maxPoolSize: 5
    });
    clientPromise = client.connect().catch(err => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}
function cleanValue(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(v => String(v).trim().slice(0, 160)).filter(Boolean);
  }
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  return String(value).trim().slice(0, MAX_TEXT_LENGTH);
}
function normalizeResponses(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Survey responses are missing or invalid.');
  }
  const responses = {};
  for (const [key, value] of Object.entries(input)) {
    if (ALLOWED_FIELDS.has(key)) responses[key] = cleanValue(value);
  }
  if (!responses.situation || !responses.industry || !responses.mainReason) {
    throw new Error('Please answer the required questions before submitting.');
  }
  return responses;
}
function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not answered';
  return value === '' || value === undefined ? 'Not answered' : String(value);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.MONGODB_URI) {
    return res.status(500).json({ error: 'Survey storage is not configured yet.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const responses = normalizeResponses(body?.responses);
    const submittedAt = new Date();
    const document = {
      survey: 'Layoff Pulse',
      schemaVersion: 1,
      submittedAt,
      responses
    };

    const client = await getClient();
    const dbName = process.env.MONGODB_DB_NAME || 'layoff_pulse';
    const collectionName = process.env.MONGODB_COLLECTION_NAME || 'survey_responses';
    const collection = client.db(dbName).collection(collectionName);
    const insertResult = await collection.insertOne(document);

    // Email is a notification; database storage remains successful even if email delivery fails.
    let emailSent = false;
    if (process.env.RESEND_API_KEY && process.env.SURVEY_NOTIFICATION_EMAIL && process.env.EMAIL_FROM) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const labels = {
          situation: 'Current situation',
          industry: 'Industry',
          experience: 'Professional experience',
          statedReason: 'Employer-stated reasons',
          mainReason: 'Believed main underlying reason',
          aiImpact: 'AI / automation impact',
          warning: 'Warning received',
          affected: 'Groups most affected',
          signs: 'Warning signs before layoffs',
          region: 'Country / region',
          impact: 'Biggest impact',
          suggestion: 'What companies should do differently',
          anythingElse: 'Additional comments'
        };
        const rows = Object.entries(labels).map(([key, label]) =>
          `<tr><th align="left" style="padding:9px;border:1px solid #ddd;background:#f5f7fb">${htmlEscape(label)}</th>` +
          `<td style="padding:9px;border:1px solid #ddd;white-space:pre-wrap">${htmlEscape(formatValue(responses[key]))}</td></tr>`
        ).join('');
        const emailResult = await resend.emails.send({
          from: process.env.EMAIL_FROM,
          to: [process.env.SURVEY_NOTIFICATION_EMAIL],
          subject: `New Layoff Pulse response — ${submittedAt.toISOString()}`,
          html: `<div style="font-family:Arial,sans-serif;color:#172033"><h2>New Layoff Pulse survey response</h2>` +
            `<p><b>Response ID:</b> ${htmlEscape(insertResult.insertedId.toString())}<br>` +
            `<b>Submitted at (UTC):</b> ${htmlEscape(submittedAt.toISOString())}</p>` +
            `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:760px">${rows}</table>` +
            `<p style="color:#687386;font-size:12px">No name, email, or employer field is collected by this survey.</p></div>`
        });
        emailSent = !emailResult.error;
        if (emailResult.error) console.error('Resend delivery error:', emailResult.error.message);
      } catch (emailError) {
        console.error('Survey notification email failed:', emailError.message);
      }
    }

    return res.status(201).json({
      ok: true,
      message: 'Survey response saved successfully.',
      responseId: insertResult.insertedId.toString(),
      emailSent
    });
  } catch (error) {
    if (error instanceof SyntaxError || error.message === 'Survey responses are missing or invalid.' ||
        error.message === 'Please answer the required questions before submitting.') {
      return res.status(400).json({ error: error.message || 'Invalid JSON body.' });
    }
    console.error('Survey submission failed:', error.message);
    return res.status(500).json({ error: 'We could not save your response. Please try again later.' });
  }
};
