import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse
} from '@simplewebauthn/server';
import BizError from '../error/biz-error';
import orm from '../entity/orm';
import passkey from '../entity/passkey';
import { and, eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import userService from './user-service';
import loginService from './login-service';
import { t } from '../i18n/i18n.js';

/**
 * Time-to-live (seconds) for a WebAuthn challenge stored in KV. The ceremony
 * must be completed within this window, otherwise the challenge is invalid.
 */
const CHALLENGE_TTL = 120;

/** KV key prefix under which pending WebAuthn challenges are stored. */
const CHALLENGE_PREFIX = 'webauthn:challenge:';

/**
 * WebAuthn (passkey) business logic.
 *
 * The cryptographic heavy lifting is delegated to `@simplewebauthn/server`;
 * this service is responsible for:
 *  - issuing single-use challenges (stored in KV, never trusted from the client),
 *  - persisting credentials in the `passkey` D1 table,
 *  - resolving the relying-party ID / origin from the incoming request so the
 *    same deployment works on any custom domain,
 *  - issuing the application's own JWT after a successful assertion by reusing
 *    `loginService.login(..., noVerifyPwd=true)` — the same hook OAuth logins use.
 *
 * @typedef {import('hono').Context} Context
 */
const webauthnService = {
	/**
	 * Lists the passkeys registered by a user. Sensitive fields (credential ID,
	 * public key) are intentionally excluded — the UI only needs display data.
	 *
	 * @param {Context} c - Hono context.
	 * @param {number} userId - Owner of the passkeys.
	 * @returns {Promise<Array<{passkeyId:number,name:string,createTime:string,lastUsedTime:string|null}>>}
	 */
	listByUser(c, userId) {
		return orm(c).select({
			passkeyId: passkey.passkeyId,
			name: passkey.name,
			createTime: passkey.createTime,
			lastUsedTime: passkey.lastUsedTime
		}).from(passkey).where(eq(passkey.userId, userId)).all();
	},

	/**
	 * Deletes a passkey, scoped to the owning user so one user cannot remove
	 * another's credential by guessing IDs.
	 *
	 * @param {Context} c - Hono context.
	 * @param {number} userId - Current authenticated user.
	 * @param {number} passkeyId - Passkey to delete.
	 * @returns {Promise<void>}
	 */
	async delete(c, userId, passkeyId) {
		await orm(c).delete(passkey)
			.where(and(eq(passkey.passkeyId, passkeyId), eq(passkey.userId, userId)))
			.run();
	},

	/**
	 * Builds registration options for `navigator.credentials.create()` and
	 * stores the issued challenge in KV. The returned `challengeId` must be
	 * echoed back by the client in {@link webauthnService.registerVerify}.
	 *
	 * @param {Context} c - Hono context (must already be authenticated).
	 * @param {number} userId - User registering a new passkey.
	 * @returns {Promise<{challengeId:string, options:import('@simplewebauthn/server').PublicKeyCredentialCreationOptionsJSON}>}
	 */
	async registerOptions(c, userId) {
		const user = await userService.selectById(c, userId);
		const existing = await orm(c).select().from(passkey).where(eq(passkey.userId, userId)).all();
		const rpId = new URL(c.req.url).hostname;

		const options = await generateRegistrationOptions({
			rpName: rpId,
			rpID: rpId,
			userName: user.email,
			userDisplayName: user.email,
			userID: new TextEncoder().encode(String(userId)),
			attestationType: 'none',
			authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
			excludeCredentials: existing.map(row => ({
				id: row.credentialId,
				...(row.transports ? { transports: row.transports.split(',') } : {})
			}))
		});

		const challengeId = await this.storeChallenge(c, 'register', userId, options.challenge);
		return { challengeId, options };
	},

	/**
	 * Verifies an attestation response and persists the new credential.
	 *
	 * @param {Context} c - Hono context (must already be authenticated).
	 * @param {number} userId - User the credential will belong to.
	 * @param {{challengeId:string, name:string, credential:object}} body - Client payload.
	 * @returns {Promise<void>}
	 * @throws {BizError} When the challenge expired, the credential already exists, or verification fails.
	 */
	async registerVerify(c, userId, body) {
		const { challengeId, name, credential } = body || {};
		const state = await this.consumeChallenge(c, challengeId, 'register');
		if (state.userId !== userId) throw new BizError(t('passkeyVerifyFail'));

		const verification = await verifyRegistrationResponse({
			response: credential,
			expectedChallenge: state.challenge,
			expectedOrigin: this.expectedOrigin(c),
			expectedRPID: new URL(c.req.url).hostname,
			requireUserVerification: false
		}).catch(() => {
			throw new BizError(t('passkeyVerifyFail'));
		});

		if (!verification.verified || !verification.registrationInfo) {
			throw new BizError(t('passkeyVerifyFail'));
		}

		const { credential: cred, counter } = verification.registrationInfo;

		const existing = await orm(c).select().from(passkey)
			.where(eq(passkey.credentialId, cred.id)).get();
		if (existing) throw new BizError(t('passkeyExists'));

		await orm(c).insert(passkey).values({
			userId,
			credentialId: cred.id,
			publicKey: this.encodePublicKey(cred.publicKey),
			counter,
			transports: (cred.transports || []).join(','),
			name: String(name || '').slice(0, 100)
		}).run();
	},

	/**
	 * Builds authentication options for `navigator.credentials.get()` scoped to
	 * the passkeys of the account identified by `email`. The challenge is
	 * stored in KV bound to that user ID, so a challenge issued for one account
	 * cannot be replayed against another.
	 *
	 * @param {Context} c - Hono context (public endpoint).
	 * @param {{email:string}} body - Client payload.
	 * @returns {Promise<{challengeId:string, options:import('@simplewebauthn/server').PublicKeyCredentialRequestOptionsJSON}>}
	 * @throws {BizError} `notExistUser` when the email is unknown; `passkeyNotFound` when the account has no passkeys.
	 */
	async loginOptions(c, body) {
		const { email } = body || {};
		if (!email) throw new BizError(t('emailAndPwdEmpty'));

		const userRow = await userService.selectByEmailIncludeDel(c, email);
		if (!userRow) throw new BizError(t('notExistUser'));

		const rows = await orm(c).select().from(passkey).where(eq(passkey.userId, userRow.userId)).all();
		if (!rows.length) throw new BizError(t('passkeyNotFound'));

		const options = await generateAuthenticationOptions({
			rpID: new URL(c.req.url).hostname,
			userVerification: 'preferred',
			allowCredentials: rows.map(row => ({
				id: row.credentialId,
				...(row.transports ? { transports: row.transports.split(',') } : {})
			}))
		});

		const challengeId = await this.storeChallenge(c, 'login', userRow.userId, options.challenge);
		return { challengeId, options };
	},

	/**
	 * Verifies an assertion response. On success the signature counter is
	 * advanced, `last_used_time` is stamped, and a regular application JWT is
	 * issued via the shared login path.
	 *
	 * @param {Context} c - Hono context (public endpoint).
	 * @param {{challengeId:string, credential:object}} body - Client payload.
	 * @returns {Promise<string>} Application JWT, identical in shape to a password login token.
	 * @throws {BizError} On any verification failure.
	 */
	async loginVerify(c, body) {
		const { challengeId, credential } = body || {};
		const state = await this.consumeChallenge(c, challengeId, 'login');

		const row = await orm(c).select().from(passkey)
			.where(and(eq(passkey.credentialId, credential.id), eq(passkey.userId, state.userId)))
			.get();
		if (!row) throw new BizError(t('passkeyVerifyFail'));

		const verification = await verifyAuthenticationResponse({
			response: credential,
			expectedChallenge: state.challenge,
			expectedOrigin: this.expectedOrigin(c),
			expectedRPID: new URL(c.req.url).hostname,
			requireUserVerification: false,
			credential: {
				id: row.credentialId,
				publicKey: this.decodePublicKey(row.publicKey),
				counter: row.counter,
				...(row.transports ? { transports: row.transports.split(',') } : {})
			}
		}).catch(() => {
			throw new BizError(t('passkeyVerifyFail'));
		});

		if (!verification.verified) throw new BizError(t('passkeyVerifyFail'));

		await orm(c).update(passkey).set({
			counter: verification.authenticationInfo.newCounter,
			lastUsedTime: sql`CURRENT_TIMESTAMP`
		}).where(eq(passkey.passkeyId, row.passkeyId)).run();

		const userRow = await userService.selectByIdIncludeDel(c, state.userId);
		// Reuses the exact OAuth login path: same JWT, KV session bookkeeping,
		// and deleted/banned account enforcement.
		return loginService.login(c, { email: userRow.email, password: null }, true);
	},

	/**
	 * Stores a freshly generated challenge in KV, keyed by a random ID. The
	 * challenge itself never leaves the server except inside the options sent
	 * to the authenticator; the client only ever sees and returns `challengeId`.
	 *
	 * @param {Context} c - Hono context.
	 * @param {'register'|'login'} type - Ceremony type, double-checked on consume.
	 * @param {number} userId - User the challenge is bound to.
	 * @param {string} challenge - Base64url challenge from SimpleWebAuthn.
	 * @returns {Promise<string>} The challenge ID to hand to the client.
	 */
	async storeChallenge(c, type, userId, challenge) {
		const challengeId = uuidv4();
		await c.env.kv.put(CHALLENGE_PREFIX + challengeId, JSON.stringify({ type, userId, challenge }), {
			expirationTtl: CHALLENGE_TTL
		});
		return challengeId;
	},

	/**
	 * Reads and immediately deletes a challenge, making it single-use.
	 *
	 * @param {Context} c - Hono context.
	 * @param {string} challengeId - ID previously returned to the client.
	 * @param {'register'|'login'} type - Expected ceremony type.
	 * @returns {Promise<{type:string,userId:number,challenge:string}>}
	 * @throws {BizError} `passkeyChallengeExpired` when the ID is unknown, expired, or of the wrong type.
	 */
	async consumeChallenge(c, challengeId, type) {
		if (!challengeId) throw new BizError(t('passkeyChallengeExpired'));
		const key = CHALLENGE_PREFIX + challengeId;
		const state = await c.env.kv.get(key, { type: 'json' });
		await c.env.kv.delete(key);
		if (!state || state.type !== type) throw new BizError(t('passkeyChallengeExpired'));
		return state;
	},

	/**
	 * Derives the expected WebAuthn origin from the incoming request. Using the
	 * request URL keeps the same deployment working on `localhost`, `nip.io`
	 * domains, and any custom production domain without configuration.
	 *
	 * @param {Context} c - Hono context.
	 * @returns {string} e.g. `https://mail.example.com`
	 */
	expectedOrigin(c) {
		const url = new URL(c.req.url);
		return `${url.protocol}//${url.host}`;
	},

	/**
	 * Serializes a credential public key for storage. SimpleWebAuthn returns it
	 * as `Uint8Array`; we persist it as base64url text.
	 *
	 * @param {Uint8Array} publicKey - COSE-encoded public key bytes.
	 * @returns {string} Base64url string.
	 */
	encodePublicKey(publicKey) {
		return btoa(String.fromCharCode(...publicKey))
			.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	},

	/**
	 * Restores a public key persisted by {@link webauthnService.encodePublicKey}.
	 *
	 * @param {string} b64url - Stored base64url string.
	 * @returns {Uint8Array} COSE-encoded public key bytes.
	 */
	decodePublicKey(b64url) {
		let str = b64url.replace(/-/g, '+').replace(/_/g, '/');
		while (str.length % 4) str += '=';
		return Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
	}
};

export default webauthnService;
