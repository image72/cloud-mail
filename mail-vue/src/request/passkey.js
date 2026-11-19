import http from '@/axios/index.js';

/**
 * Fetches the current user's passkeys (display data only).
 *
 * @returns {Promise<Array<{passkeyId:number,name:string,createTime:string,lastUsedTime:string|null}>>}
 */
export function passkeyList() {
	return http.get('/my/passkey/list');
}

/**
 * Starts a passkey registration ceremony for the current user.
 *
 * @returns {Promise<{challengeId:string, options:object}>} Options to pass to
 *   `startRegistration()` from `@simplewebauthn/browser`, plus the challenge
 *   ID that must be echoed back to `passkeyRegisterVerify`.
 */
export function passkeyRegisterOptions() {
	return http.post('/my/passkey/register/options');
}

/**
 * Finishes a passkey registration ceremony.
 *
 * @param {string} challengeId - Challenge ID from `passkeyRegisterOptions`.
 * @param {string} name - User-chosen display name for the passkey.
 * @param {object} credential - Attestation response from `startRegistration()`.
 * @returns {Promise<null>}
 */
export function passkeyRegisterVerify(challengeId, name, credential) {
	return http.post('/my/passkey/register/verify', {challengeId, name, credential});
}

/**
 * Deletes one of the current user's passkeys.
 *
 * @param {number} passkeyId - Passkey to delete.
 * @returns {Promise<null>}
 */
export function passkeyDelete(passkeyId) {
	return http.delete(`/my/passkey/delete/${passkeyId}`);
}

/**
 * Starts a passkey login ceremony for the account identified by `email`.
 *
 * @param {string} email - Full email address of the account.
 * @returns {Promise<{challengeId:string, options:object}>} Options to pass to
 *   `startAuthentication()` plus the challenge ID for `passkeyLoginVerify`.
 */
export function passkeyLoginOptions(email) {
	return http.post('/login/passkey/options', {email});
}

/**
 * Finishes a passkey login ceremony. On success resolves to `{ token }`, the
 * same shape as a password login response.
 *
 * @param {string} challengeId - Challenge ID from `passkeyLoginOptions`.
 * @param {object} credential - Assertion response from `startAuthentication()`.
 * @returns {Promise<{token:string}>}
 */
export function passkeyLoginVerify(challengeId, credential) {
	return http.post('/login/passkey/verify', {challengeId, credential});
}
