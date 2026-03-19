require('dotenv').config();
const express = require('express');
const path = require('path');
const { XeroClient } = require('xero-node');
const cors = require('cors');
const { createClient } = require('redis');

const app = express();
app.use(cors());

// Password protection
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/callback') return next();
  const password = req.headers['x-api-password'];
  if (password !== process.env.API_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [process.env.REDIRECT_URI],
  scopes: [
    'openid', 'profile', 'email', 'offline_access',
    'accounting.invoices.read',
    'accounting.contacts.read',
    'accounting.settings.read',
    'accounting.reports.aged.read',
    'accounting.reports.trialbalance.read',
    'accounting.reports.banksummary.read'
  ]
});

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect();

let tenantId = null;

async function saveTokens(tokenSet, tid) {
  await redisClient.set('xero_tokens', JSON.stringify({ tokenSet, tenantId: tid }));
}

async function loadTokens() {
  try {
    const data = await redisClient.get('xero_tokens');
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

async function startup() {
  const saved = await loadTokens();
  if (saved) {
    xero.setTokenSet(saved.tokenSet);
    tenantId = saved.tenantId;
    console.log('Tokens loaded from Redis');
  }
}
startup();

app.get('/', async (req, res) => {
  const consentUrl = await xero.buildConsentUrl();
  res.send(`<a href="${consentUrl}">Connect to Xero</a>`);
});

app.get('/callback', async (req, res) => {
  const tokenSet = await xero.apiCallback(req.url);
  await xero.updateTenants();
  tenantId = xero.tenants[0].tenantId;
  await saveTokens(tokenSet, tenantId);
  res.send('Successfully connected to Xero!');
});

app.get('/organisations', async (req, res) => {
  await xero.updateTenants();
  const orgs = xero.tenants.map(t => ({
    tenantId: t.tenantId,
    name: t.tenantName
  }));
  res.json(orgs);
});

app.get('/switch/:tenantId', async (req, res) => {
  const { tenantId: newTenantId } = req.params;
  const tenant = xero.tenants.find(t => t.tenantId === newTenantId);
  if (!tenant) {
    return res.status(404).json({ error: 'Organisation not found' });
  }
  tenantId = newTenantId;
  await saveTokens(xero.tokenSet, tenantId);
  res.json({ success: true, organisation: tenant.tenantName });
});

app.get('/invoices', async (req, res) => {
  let page = 1;
  let allInvoices = [];
  while (true) {
    const response = await xero.accountingApi.getInvoices(
      tenantId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['AUTHORISED'],
      page,
      true,
      true,
      undefined,
      true
    );
    const invoices = response.body.invoices;
    if (!invoices || invoices.length === 0) break;
    allInvoices = allInvoices.concat(invoices);
    page++;
  }
  res.json(allInvoices);
});

app.get('/accounts', async (req, res) => {
  const response = await xero.accountingApi.getAccounts(tenantId);
  res.json(response.body.accounts);
});

app.get('/reports/trialbalance', async (req, res) => {
  const response = await xero.accountingApi.getReportTrialBalance(tenantId);
  res.json(response.body.reports);
});

app.get('/reports/rollingtrialbalance', async (req, res) => {
  const results = [];
  const now = new Date();
  let date = new Date(2000, 0, 31);

  while (date <= now) {
    const dateStr = date.toISOString().split('T')[0];
    try {
      const response = await xero.accountingApi.getReportTrialBalance(tenantId, dateStr);
      const report = response.body.reports[0];
      if (report && report.rows) {
        report.rows.forEach(section => {
          if (section.rowType === 'Section' && section.rows) {
            section.rows.forEach(row => {
              if (row.rowType === 'Row' && row.cells && row.cells.length >= 5) {
                results.push({
                  month: dateStr,
                  account: row.cells[0]?.value || '',
                  debit: row.cells[1]?.value || '',
                  credit: row.cells[2]?.value || '',
                  ytdDebit: row.cells[3]?.value || '',
                  ytdCredit: row.cells[4]?.value || ''
                });
              }
            });
          }
        });
      }
    } catch (e) {
      // Skip months with no data
    }
    date = new Date(date.getFullYear(), date.getMonth() + 2, 0);
  }
  res.json(results);
});

// Get consent URL for connecting new organisation
app.get('/connect', async (req, res) => {
  const consentUrl = await xero.buildConsentUrl();
  res.json({ url: consentUrl });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});