const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'cash_register_closings',
    multipleStatements: true,
  });

  const [cols] = await conn.query(
    "SHOW COLUMNS FROM cash_closings LIKE 'businessDateKey'",
  );
  console.log('businessDateKey:', cols);

  const [idx] = await conn.query('SHOW INDEX FROM cash_closings');
  console.log(
    'indexes:',
    idx.map((i) => ({
      name: i.Key_name,
      col: i.Column_name,
      unique: i.Non_unique,
      seq: i.Seq_in_index,
    })),
  );

  const [fks] = await conn.query(`
    SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cash_closings'
      AND REFERENCED_TABLE_NAME IS NOT NULL
  `);
  console.log('fks:', fks);

  // 1) Ensure column
  if (!cols.length) {
    await conn.query(
      'ALTER TABLE cash_closings ADD COLUMN businessDateKey VARCHAR(80) NULL AFTER businessDate',
    );
    console.log('Added businessDateKey');
  }

  // 2) Backfill
  const [upd] = await conn.query(`
    UPDATE cash_closings
    SET businessDateKey = DATE_FORMAT(businessDate, '%Y-%m-%d')
    WHERE businessDateKey IS NULL OR businessDateKey = ''
  `);
  console.log('Backfill:', upd.affectedRows);

  // 3) Standalone shopId index so FK survives dropping composite unique
  const hasShopIdx = idx.some(
    (i) =>
      i.Key_name === 'IDX_cash_closings_shopId' ||
      (i.Column_name === 'shopId' && i.Seq_in_index === 1 && !idx.some(
        (j) => j.Key_name === i.Key_name && j.Seq_in_index === 2,
      )),
  );
  // Always ensure named index exists
  const namedShop = idx.some((i) => i.Key_name === 'IDX_cash_closings_shopId');
  if (!namedShop) {
    try {
      await conn.query(
        'CREATE INDEX IDX_cash_closings_shopId ON cash_closings (shopId)',
      );
      console.log('Created IDX_cash_closings_shopId');
    } catch (e) {
      console.log('shopId index create:', e.message);
    }
  }

  // 4) New unique
  const [idx2] = await conn.query('SHOW INDEX FROM cash_closings');
  const hasNewUq = idx2.some((i) => i.Key_name === 'uq_shop_date_key');
  if (!hasNewUq) {
    // Also check TypeORM-style unique on shopId+businessDateKey
    const already = idx2.filter((i) => i.Non_unique === 0 && i.Column_name === 'businessDateKey');
    if (!already.length) {
      await conn.query(
        'ALTER TABLE cash_closings ADD UNIQUE KEY uq_shop_date_key (shopId, businessDateKey)',
      );
      console.log('Created uq_shop_date_key');
    } else {
      console.log('Unique on businessDateKey already exists:', already[0].Key_name);
    }
  }

  // 5) Drop old unique on (shopId, businessDate) if present
  const [idx3] = await conn.query('SHOW INDEX FROM cash_closings');
  const oldUniqueNames = new Set();
  for (const i of idx3) {
    if (i.Non_unique !== 0) continue;
    if (i.Key_name === 'PRIMARY' || i.Key_name === 'uq_shop_date_key') continue;
    // Collect uniques that include businessDate as a column
  }
  const byName = {};
  for (const i of idx3) {
    if (!byName[i.Key_name]) byName[i.Key_name] = [];
    byName[i.Key_name].push(i);
  }
  for (const [name, colsOf] of Object.entries(byName)) {
    if (name === 'PRIMARY' || name === 'uq_shop_date_key') continue;
    if (colsOf[0].Non_unique !== 0) continue;
    const colNames = colsOf
      .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
      .map((c) => c.Column_name);
    if (
      colNames.length === 2 &&
      colNames[0] === 'shopId' &&
      colNames[1] === 'businessDate'
    ) {
      oldUniqueNames.add(name);
    }
  }

  for (const name of oldUniqueNames) {
    await conn.query(`ALTER TABLE cash_closings DROP INDEX \`${name}\``);
    console.log('Dropped old unique:', name);
  }

  const [finalIdx] = await conn.query('SHOW INDEX FROM cash_closings');
  console.log(
    'final indexes:',
    finalIdx.map((i) => ({
      name: i.Key_name,
      col: i.Column_name,
      unique: i.Non_unique,
      seq: i.Seq_in_index,
    })),
  );

  await conn.end();
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
