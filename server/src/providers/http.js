// fetch with retries for flaky networks and busy upstreams (429/503).
// Non-idempotent calls (starting a paid render) only retry when the request
// provably never reached the server, so a retry can't double-charge.
const CONNECT_ERRORS = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT'];

export async function fetchRetry(url, init = {}, { idempotent = true, attempts = 4 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, init);
      if ((res.status === 429 || res.status === 503) && i < attempts) {
        await sleep(i);
        continue;
      }
      return res;
    } catch (err) {
      const code = err.cause?.code;
      const safe = idempotent || CONNECT_ERRORS.includes(code);
      if (!safe || i >= attempts) throw new Error(`Network error talking to Google (${code || err.message}). Check the connection and try again.`);
      await sleep(i);
    }
  }
}

const sleep = (attempt) => new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
