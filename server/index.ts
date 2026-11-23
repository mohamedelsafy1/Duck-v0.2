import { config } from './config.ts';
import { openDb } from './db.ts';
import { seedAll } from './seed.ts';
import { createApp } from './app.ts';

const db = await openDb();
await seedAll(db);
const app = createApp(db);
app.listen(config.port, '0.0.0.0', () => console.log(`duckprompts listening on :${config.port} (db=${db.kind}, ai=${config.aiProvider})`));
