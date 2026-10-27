# Dum & Co. – Restaurant app (Node.js, Express, MongoDB)

Customer site: ordering (delivery/pickup), table booking, feedback. Admin dashboard: orders, bookings, menu, reviews.

## Run
1. Install Node 18+ and MongoDB (or use a free MongoDB Atlas URI).
2. `cp .env.example .env` and set `MONGO_URI` and `ADMIN_PASSWORD`.
3. `npm install`
4. `npm start`
5. Customer site: http://localhost:3000 · Admin: http://localhost:3000/admin.html

The menu is seeded with sample dishes on first run.

## Structure
- `server.js` – models, validation, public and admin REST API
- `public/index.html` – responsive customer site
- `public/admin.html` – admin dashboard

## Before going live
Order totals are calculated on the server from database prices. The admin token is kept in server memory (it resets on restart); for production, add HTTPS, rate limiting (express-rate-limit), helmet, and a proper user/JWT system.
