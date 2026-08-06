# QA harness

Not part of the deploy. Needs the app running on http://127.0.0.1:3000 and a
reachable database.

```bash
cd qa && npm init -y && npm install puppeteer
node full.js       # 70 assertions: register → onboarding → scan → 14 routes
                   # → CRUD → live audit → tools → exports → reload → sign out
node hobby.js      # queue drains with no cron at all (Vercel free tier)
node sec.js        # 25 assertions: cross-tenant isolation on every endpoint
node sec2.js       # SSRF, privilege escalation, rate limits, input validation
node sec3.js       # password change/reset, session expiry, audit hardening
node sec4.js       # XSS injection through every user-controlled field
node sec5.js       # queue concurrency, duplicate protection, provider outage
node vis-live.js   # overflow, contrast, tap targets across 17 screens × 2 sizes
```

The rate limiter blocks repeated runs from one IP. Between suites:

```sql
truncate rate_limits;
```
