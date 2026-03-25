#!/usr/bin/env node
/**
 * AskElira.com Load Test
 * Runs N concurrent goal-creation requests and monitors for failures.
 */
const https = require('https');

const BASE_URL = 'https://askelira-bundled-npm.vercel.app';
const CONCURRENCY = 15;
const GOALS = [
  'Build a Python script to scrape HackerNews top stories',
  'Create a Chrome extension that blocks distracting websites',
  'Build a daily crypto price alert system via email',
  'Create a Notion template for weekly code reviews',
  'Build an AI-powered news summarizer for RSS feeds',
  'Create a Slack bot that tracks team standup updates',
  'Build an automated invoice generator from Google Sheets',
  'Create a web scraper for competitor pricing data',
  'Build a habit tracker with Streak notifications',
  'Create an automated social media content calendar',
  'Build a Zoom meeting summary generator via transcription',
  'Create a budget tracker with bank API integration',
  'Build a personal CRM for freelance client management',
  'Create an automated cold email outreach tool',
  'Build a portfolio website with AI-generated copy',
];

const results = { success: 0, failed: 0, errors: [] };

function createGoal(goalText, id) {
  return new Promise((resolve) => {
    const start = Date.now();
    const body = JSON.stringify({ goalText, email: 'alvin.kerremans@gmail.com' });
    const req = https.request(
      `${BASE_URL}/api/goals/new`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'alvin.kerremans@gmail.com',
          'x-email': 'alvin.kerremans@gmail.com',
          'x-customer-id': 'alvin.kerremans@gmail.com',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const ms = Date.now() - start;
          const ok = res.statusCode >= 200 && res.statusCode < 300;
          if (ok) {
            results.success++;
            console.log(`[${id}] ✅ ${res.statusCode} (${ms}ms)`);
          } else {
            results.failed++;
            results.errors.push({ id, status: res.statusCode, body: data.substring(0, 200), ms });
            console.log(`[${id}] ❌ ${res.statusCode} (${ms}ms) — ${data.substring(0, 100)}`);
          }
          resolve();
        });
      }
    );
    req.on('error', (e) => {
      results.failed++;
      results.errors.push({ id, error: e.message });
      console.log(`[${id}] ❌ ERROR — ${e.message}`);
      resolve();
    });
    req.write(body);
    req.end();
    setTimeout(() => {
      if (!results.success && !results.failed) return;
      // still pending
    }, 30000);
  });
}

async function run() {
  console.log(`🚀 Starting load test — ${CONCURRENCY} concurrent goal creations vs ${BASE_URL}`);
  console.log(`   Goals: ${GOALS.slice(0, CONCURRENCY).map((g, i) => `${i + 1}. ${g.substring(0, 40)}...`).join('\n   ')}`);
  console.log('---\n');

  const promises = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    promises.push(createGoal(GOALS[i % GOALS.length], i + 1));
  }

  await Promise.all(promises);

  console.log('\n--- RESULTS ---');
  console.log(`✅ Success: ${results.success}/${CONCURRENCY}`);
  console.log(`❌ Failed:  ${results.failed}/${CONCURRENCY}`);
  if (results.errors.length > 0) {
    console.log('\nErrors:');
    results.errors.forEach((e) => console.log(JSON.stringify(e)));
  }

  const output = JSON.stringify(results, null, 2);
  require('fs').writeFileSync('/tmp/load-test-results.json', output);
  console.log('\nResults saved to /tmp/load-test-results.json');
}

run().catch(console.error);
