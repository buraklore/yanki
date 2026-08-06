import fs from 'node:fs';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

const sql = postgres(url, {
  ssl: /localhost|127\.0\.0\.1|\/var\/run/.test(url) ? false : 'require',
  max: 1,
});

const schema = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
try {
  await sql.unsafe(schema);
  const [{ count }] = await sql`select count(*)::int from engines`;
  console.log(`schema applied · ${count} engines registered`);
} catch (e) {
  console.error('migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
