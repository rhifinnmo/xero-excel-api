require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const { XeroClient } = require('xero-node');

const app = express();

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

let tenantId = null;

app.get('/', async (req, res) => {
  const consentUrl = await xero.buildConsentUrl();
  res.send(`<a href="${consentUrl}">Connect to Xero</a>`);
});

app.get('/callback', async (req, res) => {
  await xero.apiCallback(req.url);
  await xero.updateTenants();
  tenantId = xero.tenants[0].tenantId;
  res.send('Successfully connected to Xero!');
});

// Invoices - loop through all pages
app.get('/invoices', async (req, res) => {
  let page = 1;
  let allInvoices = [];
  while (true) {
    const response = await xero.accountingApi.getInvoices(
      tenantId, 
      undefined, // ifModifiedSince
      undefined, // where
      undefined, // order
      undefined, // IDs
      undefined, // invoiceNumbers
      undefined, // contactIDs
      ['AUTHORISED'], // statuses - only unpaid authorised invoices
      page,
      true, // includeArchived
      true, // createdByMyApp
      undefined, // unitdp
      true // summaryOnly = false to get full details
    );
    const invoices = response.body.invoices;
    if (!invoices || invoices.length === 0) break;
    allInvoices = allInvoices.concat(invoices);
    page++;
  }
  res.json(allInvoices);
});

// Contacts - loop through all pages
app.get('/contacts', async (req, res) => {
  let page = 1;
  let allContacts = [];
  while (true) {
    const response = await xero.accountingApi.getContacts(tenantId, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, page);
    const contacts = response.body.contacts;
    if (!contacts || contacts.length === 0) break;
    allContacts = allContacts.concat(contacts);
    page++;
  }
  res.json(allContacts);
});

// Chart of Accounts
app.get('/accounts', async (req, res) => {
  const response = await xero.accountingApi.getAccounts(tenantId);
  res.json(response.body.accounts);
});

// Bank Transactions - loop through all pages
app.get('/banktransactions', async (req, res) => {
  let page = 1;
  let allTransactions = [];
  while (true) {
    const response = await xero.accountingApi.getBankTransactions(tenantId, undefined, undefined, undefined, undefined, page);
    const transactions = response.body.bankTransactions;
    if (!transactions || transactions.length === 0) break;
    allTransactions = allTransactions.concat(transactions);
    page++;
  }
  res.json(allTransactions);
});

// Trial Balance
app.get('/reports/trialbalance', async (req, res) => {
  const response = await xero.accountingApi.getReportTrialBalance(tenantId);
  res.json(response.body.reports);
});

const options = {
  key: fs.readFileSync('localhost-key.pem'),
  cert: fs.readFileSync('localhost.pem')
};

https.createServer(options, app).listen(3000, () => {
  console.log('Server running on https://localhost:3000');
});