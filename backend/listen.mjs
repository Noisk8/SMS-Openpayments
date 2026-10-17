// Listener de demo: vigila nuevos SMS y cambios de estado de pago en la Postgres
// compartida y los imprime. Solo lectura; no envía ni mueve nada.
import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MINUTES = Number(process.env.LISTEN_MINUTES ?? 45);

let lastSms = (await pool.query("SELECT COALESCE(MAX(seq),0) AS m FROM sms_messages")).rows[0].m;
let lastPay = (await pool.query("SELECT COALESCE(MAX(seq),0) AS m FROM payments")).rows[0].m;
const states = new Map();
const deadline = Date.now() + MINUTES * 60 * 1000;

console.log(`[listener] watching from sms>${lastSms} payments>${lastPay} for ${MINUTES} min`);

while (Date.now() < deadline) {
  try {
    const sms = await pool.query(
      "SELECT seq, direction, from_phone, to_phone, text, created_at FROM sms_messages WHERE seq > $1 ORDER BY seq",
      [lastSms],
    );
    for (const r of sms.rows) {
      console.log(`[sms:${r.direction}] ${r.from_phone} -> ${r.to_phone} :: ${JSON.stringify(r.text)}`);
      lastSms = Math.max(lastSms, Number(r.seq));
    }

    const pay = await pool.query("SELECT seq, state, debit_value, receive_value, last_error FROM payments WHERE seq > $1 ORDER BY seq", [lastPay]);
    for (const r of pay.rows) {
      console.log(`[payment:new] seq=${r.seq} state=${r.state} debit=${r.debit_value} receive=${r.receive_value} err=${r.last_error ?? "-"}`);
      states.set(Number(r.seq), r.state);
      lastPay = Math.max(lastPay, Number(r.seq));
    }

    const rows = await pool.query("SELECT seq, state, last_error FROM payments ORDER BY seq DESC LIMIT 10");
    for (const r of rows.rows) {
      const prev = states.get(Number(r.seq));
      if (prev === undefined) {
        states.set(Number(r.seq), r.state);
      } else if (prev !== r.state) {
        console.log(`[payment:state] seq=${r.seq} ${prev} -> ${r.state}${r.last_error ? ` (err=${r.last_error})` : ""}`);
        states.set(Number(r.seq), r.state);
      }
    }
  } catch (error) {
    console.log("[listener:error]", error.message);
  }
  await sleep(3000);
}

console.log("[listener] done");
await pool.end();
