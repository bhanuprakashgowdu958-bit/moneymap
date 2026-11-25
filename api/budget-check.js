// Vercel Serverless Function: App-Open Pre-Order Budget Guard
// Called by Apple Shortcuts ("When App Opens") or Android MacroDroid ("Application Launched")
// before the user places an order on food delivery / shopping apps.

import {
  CATEGORY_LABELS,
  evaluateCategoryBudget,
  getUserCurrency,
  resolveTokenUid,
} from './_budgetHelper.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  }

  const token = req.query?.token || req.headers['x-webhook-token'] || req.body?.token;
  const rawCategory = req.query?.category || req.body?.category || 'food-delivery';
  const category = CATEGORY_LABELS[rawCategory] ? rawCategory : 'food-delivery';
  const format = req.query?.format || req.body?.format || 'json';

  try {
    const resolved = await resolveTokenUid(token);
    if (resolved.error) {
      return res.status(resolved.status).json({ error: resolved.error });
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const currency = await getUserCurrency(resolved.uid);
    const budget = await evaluateCategoryBudget(resolved.uid, category, month, year, currency);

    if (format === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(budget.shouldAlert ? budget.message : '');
    }

    return res.status(200).json({
      success: true,
      ...budget,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
