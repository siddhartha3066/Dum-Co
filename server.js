require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Models ---------- */
const MenuItem = mongoose.model('MenuItem', new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  category: { type: String, required: true },
  available: { type: Boolean, default: true }
}, { timestamps: true }));

const Order = mongoose.model('Order', new mongoose.Schema({
  customer: { name: String, phone: String, address: String, note: String },
  type: { type: String, enum: ['delivery', 'pickup'], default: 'delivery' },
  items: [{ item: mongoose.Schema.Types.ObjectId, name: String, price: Number, qty: Number }],
  total: Number,
  status: { type: String, enum: ['new', 'preparing', 'ready', 'delivered', 'cancelled'], default: 'new' }
}, { timestamps: true }));

const Booking = mongoose.model('Booking', new mongoose.Schema({
  name: String, phone: String, date: String, time: String,
  guests: { type: Number, min: 1, max: 20 }, note: String,
  status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' }
}, { timestamps: true }));

const Feedback = mongoose.model('Feedback', new mongoose.Schema({
  name: String, rating: { type: Number, min: 1, max: 5, required: true }, comment: String
}, { timestamps: true }));

/* ---------- Helpers ---------- */
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(e.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
});
const need = (obj, keys) => {
  for (const k of keys) if (!obj || !String(obj[k] ?? '').trim()) {
    const err = new Error(`${k} is required`); err.name = 'ValidationError'; throw err;
  }
};
const str = (v, n = 500) => String(v ?? '').slice(0, n);

/* ---------- Admin auth (simple token, in memory) ---------- */
const tokens = new Set();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
app.post('/api/admin/login', (req, res) => {
  const a = Buffer.from(str(req.body.password, 200)), b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    return res.status(401).json({ error: 'Wrong password' });
  const t = crypto.randomBytes(24).toString('hex');
  tokens.add(t);
  res.json({ token: t });
});
const admin = (req, res, next) =>
  tokens.has((req.headers.authorization || '').replace('Bearer ', ''))
    ? next() : res.status(401).json({ error: 'Login required' });

/* ---------- Public API ---------- */
app.get('/api/menu', wrap(async (req, res) => {
  res.json(await MenuItem.find({ available: true }).sort({ category: 1, name: 1 }));
}));

app.post('/api/orders', wrap(async (req, res) => {
  const { customer, items, type } = req.body;
  need(customer, ['name', 'phone']);
  if (type !== 'pickup') need(customer, ['address']);
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('Cart is empty'), { name: 'ValidationError' });
  const dbItems = await MenuItem.find({ _id: { $in: items.map(i => i.id) }, available: true });
  const lines = items.map(i => {
    const m = dbItems.find(d => String(d._id) === String(i.id));
    const qty = Math.min(Math.max(parseInt(i.qty) || 0, 1), 50);
    return m && { item: m._id, name: m.name, price: m.price, qty };
  }).filter(Boolean);
  if (!lines.length) throw Object.assign(new Error('Items unavailable'), { name: 'ValidationError' });
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0); // price comes from DB, not client
  const order = await Order.create({
    customer: { name: str(customer.name, 80), phone: str(customer.phone, 20), address: str(customer.address, 300), note: str(customer.note, 300) },
    type: type === 'pickup' ? 'pickup' : 'delivery', items: lines, total
  });
  res.status(201).json({ id: order._id, total });
}));

app.post('/api/bookings', wrap(async (req, res) => {
  need(req.body, ['name', 'phone', 'date', 'time', 'guests']);
  const b = await Booking.create({
    name: str(req.body.name, 80), phone: str(req.body.phone, 20), date: str(req.body.date, 10),
    time: str(req.body.time, 5), guests: parseInt(req.body.guests), note: str(req.body.note, 300)
  });
  res.status(201).json({ id: b._id });
}));

app.get('/api/feedback', wrap(async (req, res) => {
  res.json(await Feedback.find().sort({ createdAt: -1 }).limit(12));
}));
app.post('/api/feedback', wrap(async (req, res) => {
  need(req.body, ['rating']);
  const f = await Feedback.create({
    name: str(req.body.name, 80) || 'Guest', rating: parseInt(req.body.rating), comment: str(req.body.comment, 600)
  });
  res.status(201).json(f);
}));

/* ---------- Admin API ---------- */
app.get('/api/admin/stats', admin, wrap(async (req, res) => {
  const [orders, bookings, feedback, revenue] = await Promise.all([
    Order.countDocuments(), Booking.countDocuments({ status: 'pending' }), Feedback.find(),
    Order.aggregate([{ $match: { status: { $ne: 'cancelled' } } }, { $group: { _id: null, t: { $sum: '$total' } } }])
  ]);
  const avg = feedback.length ? feedback.reduce((s, f) => s + f.rating, 0) / feedback.length : 0;
  res.json({ orders, pendingBookings: bookings, reviews: feedback.length, avgRating: +avg.toFixed(1), revenue: revenue[0]?.t || 0 });
}));
app.get('/api/admin/orders', admin, wrap(async (req, res) => res.json(await Order.find().sort({ createdAt: -1 }).limit(100))));
app.patch('/api/admin/orders/:id', admin, wrap(async (req, res) =>
  res.json(await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true }))));
app.get('/api/admin/bookings', admin, wrap(async (req, res) => res.json(await Booking.find().sort({ date: 1, time: 1 }).limit(100))));
app.patch('/api/admin/bookings/:id', admin, wrap(async (req, res) =>
  res.json(await Booking.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true }))));
app.get('/api/admin/feedback', admin, wrap(async (req, res) => res.json(await Feedback.find().sort({ createdAt: -1 }).limit(100))));
app.delete('/api/admin/feedback/:id', admin, wrap(async (req, res) => { await Feedback.findByIdAndDelete(req.params.id); res.json({ ok: true }); }));
app.get('/api/admin/menu', admin, wrap(async (req, res) => res.json(await MenuItem.find().sort({ category: 1, name: 1 }))));
app.post('/api/admin/menu', admin, wrap(async (req, res) => res.status(201).json(await MenuItem.create(req.body))));
app.patch('/api/admin/menu/:id', admin, wrap(async (req, res) =>
  res.json(await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }))));
app.delete('/api/admin/menu/:id', admin, wrap(async (req, res) => { await MenuItem.findByIdAndDelete(req.params.id); res.json({ ok: true }); }));

/* ---------- Start ---------- */
const seed = [
  ['Hyderabadi Chicken Dum Biryani', 'Basmati sealed and slow-cooked with marinated chicken', 320, 'Biryani'],
  ['Mutton Dum Biryani', 'Tender mutton, saffron, fried onions', 420, 'Biryani'],
  ['Paneer Biryani', 'Spiced paneer layered with fragrant rice', 280, 'Biryani'],
  ['Chicken 65', 'Crisp-fried, curry leaf and green chilli', 240, 'Starters'],
  ['Mirchi Ka Salan', 'Peanut-sesame chilli curry', 160, 'Sides'],
  ['Double Ka Meetha', 'Fried bread pudding, rabdi, saffron', 120, 'Desserts'],
  ['Irani Chai', 'Slow-simmered milk tea', 50, 'Drinks']
];
mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dumandco').then(async () => {
  if (!(await MenuItem.countDocuments()))
    await MenuItem.insertMany(seed.map(([name, description, price, category]) => ({ name, description, price, category })));
  app.listen(process.env.PORT || 3000, () => console.log('Running on http://localhost:' + (process.env.PORT || 3000)));
}).catch(e => { console.error('MongoDB connection failed:', e.message); process.exit(1); });
