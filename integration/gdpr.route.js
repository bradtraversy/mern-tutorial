'use strict';
const express = require('express');
const path = require('node:path');
const mongoose = require('mongoose');
const Joi = require('joi');
const { randomUUID } = require('node:crypto');
const { GdprRouter } = require('./privacy-lib/gdpr-router.cjs');
const config = require('./privacy-config.json');
const Goal = require('../backend/models/goalModel');
const catchAsync = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function ApiError(status, message) { return Object.assign(new Error(message), { status }); }
const auth = () => (req, res, next) => req.gdprUser ? next() : res.status(401).json({ error: 'Please sign in' });
const gdpr = new GdprRouter();
const router = express.Router();
router.get('/', (req, res) => res.sendFile(path.join(__dirname, 'gdpr.html')));
// Reuse the host's JWT guard, which loads the database user without its password.
router.use(require('../backend/middleware/authMiddleware').protect);
router.use((req, res, next) => {
  if (!req.user) return next(new ApiError(401, 'Please sign in'));
  req.gdprUser = req.user;
  next();
});
const Consent = mongoose.model('IntegrationConsent', new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  value: { type: String, enum: ['yes', 'no'], required: true },
  withdrawn: { type: Boolean, required: true },
}));
const fields = Joi.array().items(Joi.string().valid('name', 'email', 'goals')).min(1).unique();
const requestId = Joi.string().max(128);
const schemas = {
  consent: Joi.object({}),
  lawful: Joi.object({}),
  information: Joi.object({}),
  access: Joi.object({}),
  rectification: Joi.object({ request_id: requestId, updates: Joi.object({
    name: Joi.string().min(1).max(200), email: Joi.string().email(),
  }).min(1).required() }),
  erasure: Joi.object({ request_id: requestId, reason: Joi.string().max(100), fields }),
  restriction: Joi.object({ request_id: requestId, reason: Joi.string().max(100), fields }),
  portability: Joi.object({ request_id: requestId, transfer_requested: Joi.boolean(),
    transfer_service_id: Joi.string().max(100) }),
  objection: Joi.object({ request_id: requestId, reason: Joi.string().max(100), fields }),
  complaint: Joi.object({ request_id: requestId, authority_id: Joi.string().max(100).required(),
    description: Joi.string().min(1).max(2000).required() }),
  breach: Joi.object({ incident_id: Joi.string().max(128).required(),
    detected: Joi.boolean(), hours_since_detected: Joi.number().min(0),
    risks: Joi.array().items(Joi.string().valid('rights_freedoms', 'identity_theft',
      'discrimination', 'financial_loss', 'reputational_damage', 'minor')).min(1),
    summary: Joi.string().max(2000) }),
};
function validate(schema, body) {
  const result = schema.unknown(false).validate(body === undefined ? {} : body,
    { convert: false, abortEarly: false });
  if (result.error) throw new ApiError(400, result.error.details.map(item => item.message).join('; '));
  return result.value;
}
router.patch('/consent', auth(), catchAsync(async (req, res) => {
  const value = validate(Joi.object({
    value: Joi.string().valid('yes', 'no').required(), withdrawn: Joi.boolean().required(),
  }), req.body);
  const record = await Consent.findOneAndUpdate({ userId: req.gdprUser._id }, value,
    { upsert: true, new: true, runValidators: true });
  res.json({ value: record.value, withdrawn: record.withdrawn });
}));
router.post('/:policy', auth(), catchAsync(async (req, res) => {
  const policy = req.params.policy;
  if (!Object.hasOwn(schemas, policy)) throw new ApiError(400, 'Unknown GDPR operation');
  // Incident assessment is an administrative operation, not a user self-service right.
  if (policy === 'breach' && !(process.env.GDPR_ADMIN_USER_IDS || '').split(',').map(id => id.trim()).includes(String(req.gdprUser._id))) throw new ApiError(403, 'Administrator access required');
  const value = validate(schemas[policy], req.body);
  const userId = String(req.gdprUser._id);
  const consent = await Consent.findOne({ userId: req.gdprUser._id }).lean();
  const goals = await Goal.find({ user: req.gdprUser._id }).select('_id text createdAt updatedAt').sort({ _id: 1 }).lean();
  const input = {
    controller: config.controller, dpo: config.dpo, storage: config.storage,
    lawful_purposes: config.lawful_purposes, third_parties: config.third_parties,
    services: config.services, exceptions: config.exceptions,
    supervisory_authorities: config.supervisory_authorities,
    consents: consent ? { [userId]: { value: consent.value, withdrawn: consent.withdrawn } } : {},
    users: [{ id: userId, data_items: [
      ...['name', 'email'].map(field => ({
        field, value: req.gdprUser[field], purpose: 'contract', source: 'user', purpose_presented: true,
      })),
      { field: 'goals', value: goals.map(goal => ({
        id: String(goal._id), text: goal.text,
        created_at: goal.createdAt.toISOString(), updated_at: goal.updatedAt.toISOString(),
      })), purpose: 'contract', source: 'user', purpose_presented: true },
    ] }],
    request: {},
  };
  if (policy === 'access') input.request.access = { user_id: userId };
  if (['rectification', 'erasure', 'restriction', 'portability', 'objection', 'complaint'].includes(policy)) {
    input.request[policy] = {
      ...(config.request_defaults[policy] || {}),
      ...(policy === 'portability' ? { transfer_requested: false, transfer_service_id: '' } : {}),
      ...value, request_id: value.request_id || randomUUID(),
      // Authenticated identity is authoritative, never an ID supplied by the client.
      user_id: userId, target_user_id: userId,
    };
  }
  if (policy === 'breach') input.breach = {
    ...config.breach_defaults, ...value, affected_users: [userId],
  };
  try {
    res.json(await gdpr.route(policy, input, userId));
  } catch {
    throw new ApiError(502, 'OPA evaluation failed');
  }
}));
router.use((error, req, res, next) => res.status(error.status || (res.statusCode >= 400 ? res.statusCode : 500)).json({ error: error.message }));
module.exports = router;
