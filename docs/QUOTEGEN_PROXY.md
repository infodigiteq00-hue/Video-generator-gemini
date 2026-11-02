# Serving Digiteq Studio at www.quotegen.ai/digiteqstudio

The PhonePe account is approved for www.quotegen.ai, so Digiteq Studio is served as a page of that site.
QuoteGen's Express server forwards everything under `/digiteqstudio` to the Digiteq Studio Railway service,
unchanged; Digiteq Studio itself runs exactly as before.

## 1. Digiteq Studio (Railway → its service → Variables)

```
BASE_PATH=/digiteqstudio
PUBLIC_URL=https://www.quotegen.ai/digiteqstudio
TRUST_PROXY=2
```

`BASE_PATH` is also used while building the web app, so redeploy after setting it. `TRUST_PROXY=2` because
requests now pass through two proxies (Railway's edge and QuoteGen's server) before reaching the app.

## 2. QuoteGen (its Express server, e.g. `server/index.js`)

Add this **before** any body parser (`express.json()`, `multer`, …), so uploads and payments pass through untouched,
and set `DIGITEQ_STUDIO_URL` in QuoteGen's Railway variables to the Digiteq Studio service address
(for example `https://digiteq-studio-production.up.railway.app`).

```js
import http from 'node:http';
import https from 'node:https';

// Digiteq Studio lives at /digiteqstudio: pass those requests to its own service, path and all.
const STUDIO = process.env.DIGITEQ_STUDIO_URL;
app.use((req, res, next) => {
  if (!STUDIO || !(req.url === '/digiteqstudio' || req.url.startsWith('/digiteqstudio/') || req.url.startsWith('/digiteqstudio?'))) return next();
  const target = new URL(req.url, STUDIO);
  const forwarded = req.headers['x-forwarded-for'];
  const upstream = (target.protocol === 'https:' ? https : http).request(
    target,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
        'x-forwarded-host': req.headers.host,
        'x-forwarded-proto': 'https',
        'x-forwarded-for': forwarded ? `${forwarded}, ${req.socket.remoteAddress}` : req.socket.remoteAddress,
      },
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
```

## 3. PhonePe dashboard

- Webhook URL: `https://www.quotegen.ai/digiteqstudio/api/pay/webhook`, with a username and password you choose
  (put them in Digiteq Studio's variables as `PHONEPE_WEBHOOK_USERNAME` and `PHONEPE_WEBHOOK_PASSWORD`).
- The return address after paying is set by the app itself (`PUBLIC_URL` + `/api/pay/return`).

## 4. Android app

Set `server.url` in `mobile/capacitor.config.json` to `https://www.quotegen.ai/digiteqstudio` and rebuild the APK.
