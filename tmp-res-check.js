const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({host:'localhost',user:'root',password:'root',database:'cash_register_closings'});
  const [rows] = await c.query('SELECT businessDate, COUNT(*) c, SUM(partySize) g FROM reservations WHERE active=1 AND deletedAt IS NULL GROUP BY businessDate ORDER BY businessDate DESC LIMIT 15');
  console.log(rows);
  const [sample] = await c.query('SELECT businessDate, typeof FROM (SELECT businessDate FROM reservations LIMIT 1) t');
  const [one] = await c.query('SELECT businessDate FROM reservations LIMIT 1');
  console.log('sample type', one[0] && one[0].businessDate, typeof (one[0] && one[0].businessDate));
  await c.end();
})().catch(e => console.error(e));
