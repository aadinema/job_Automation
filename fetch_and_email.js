// fetch_and_email.js
// Simple daily job fetcher + emailer. Tweak selectors per site for reliability.
// Usage (locally): create a .env with required vars and run `node fetch_and_email.js`.

require('dotenv').config();
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

const JOB_BOARD_QUERIES = [
  { name: 'Wellfound', url: 'https://wellfound.com/jobs?term=react+native+entry+level' },
  { name: 'Indeed', url: 'https://in.indeed.com/jobs?q=entry+level+react+native&l=India' },
  // Add/edit queries here. You can use rss.app-generated feeds or official APIs instead of scraping.
];

const MAX_PER_BOARD = Number(process.env.MAX_PER_BOARD || 6);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 20);
const KEYWORDS = (process.env.KEYWORDS || 'entry level,junior,fresher,0-2 years,react native,web developer').split(',');

async function fetchJobs() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox'],
    headless: 'new' // or true for older puppeteer
  });
  const page = await browser.newPage();
  const results = [];

  for (const q of JOB_BOARD_QUERIES) {
    try {
      await page.goto(q.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Generic fallback extraction: collect links with "job"/"apply"/"developer" text.
      const jobs = await page.evaluate((max) => {
        const anchors = Array.from(document.querySelectorAll('a'));
        const candidates = anchors
          .map(a => ({ title: (a.innerText || a.getAttribute('title') || '').trim(), href: a.href }))
          .filter(x => x.href && x.title && x.title.length > 5)
          .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i) // unique
          .slice(0, max);
        return candidates;
      }, MAX_PER_BOARD);

      results.push({ board: q.name, url: q.url, jobs });
    } catch (err) {
      console.error(`Error fetching ${q.name}:`, err.message);
      results.push({ board: q.name, url: q.url, jobs: [], error: err.message });
    }
  }

  await browser.close();
  // flatten and limit
  const flat = results.flatMap(r => r.jobs.map(j => ({ board: r.board, ...j })));
  return flat.slice(0, MAX_TOTAL);
}

function buildHtml(jobs) {
  const date = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  let html = `<h2>Daily Job Roundup — ${date}</h2>`;
  if (!jobs || jobs.length === 0) {
    html += '<p>No jobs found for configured queries/keywords.</p>';
    return html;
  }
  html += '<ul>';
  for (const j of jobs) {
    html += `<li><strong>${j.title}</strong> — <em>${j.board}</em> — <a href="${j.href}">Link</a></li>`;
  }
  html += '</ul>';
  html += '<p>Sources searched: configured job boards. (Consider using official APIs or RSS for reliable results.)</p>';
  return html;
}

async function sendEmail(html) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_SECURE === 'true'), // true for 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const info = await transporter.sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to: process.env.TO_EMAIL,
    subject: `Daily job roundup — ${new Date().toLocaleDateString('en-IN')}`,
    html
  });

  return info;
}

(async () => {
  try {
    console.log('Starting job fetch...');
    const jobs = await fetchJobs();
    console.log(`Found ${jobs.length} job links.`);
    const html = buildHtml(jobs);
    console.log('Sending email...');
    const res = await sendEmail(html);
    console.log('Email sent. MessageId:', res.messageId || JSON.stringify(res));
  } catch (err) {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  }
})();
