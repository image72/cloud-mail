import { sqliteTable, text, integer} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
const passkey = sqliteTable('passkey', {
	passkeyId: integer('passkey_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	credentialId: text('credential_id').notNull(),
	publicKey: text('public_key').notNull(),
	counter: integer('counter').default(0).notNull(),
	transports: text('transports').default('').notNull(),
	name: text('name').default('').notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`),
	lastUsedTime: text('last_used_time')
});
export default passkey
