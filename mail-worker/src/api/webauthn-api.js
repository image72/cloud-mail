import app from '../hono/hono';
import webauthnService from '../service/webauthn-service';
import result from '../model/result';
import userContext from '../security/user-context';

/**
 * WebAuthn / passkey endpoints.
 *
 * Registration and management routes live under `/my/passkey/*` and therefore
 * inherit the global auth middleware (any logged-in user manages their own
 * passkeys; no additional permission is required).
 *
 * The login ceremony routes live under `/login/passkey/*`. `security.js`
 * already excludes the `/login` prefix, so they are reachable without a token.
 */

/** List the current user's passkeys (display data only). */
app.get('/my/passkey/list', async (c) => {
	const rows = await webauthnService.listByUser(c, userContext.getUserId(c));
	return c.json(result.ok(rows));
});

/** Start a registration ceremony: returns options + a single-use challenge ID. */
app.post('/my/passkey/register/options', async (c) => {
	const data = await webauthnService.registerOptions(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

/** Finish a registration ceremony: verifies the attestation and stores the credential. */
app.post('/my/passkey/register/verify', async (c) => {
	await webauthnService.registerVerify(c, userContext.getUserId(c), await c.req.json());
	return c.json(result.ok());
});

/** Delete one of the current user's passkeys. */
app.delete('/my/passkey/delete/:passkeyId', async (c) => {
	await webauthnService.delete(c, userContext.getUserId(c), Number(c.req.param('passkeyId')));
	return c.json(result.ok());
});

/** Start a login ceremony for the account identified by `email`. */
app.post('/login/passkey/options', async (c) => {
	const data = await webauthnService.loginOptions(c, await c.req.json());
	return c.json(result.ok(data));
});

/** Finish a login ceremony: on success returns `{ token }`, same as `/login`. */
app.post('/login/passkey/verify', async (c) => {
	const token = await webauthnService.loginVerify(c, await c.req.json());
	return c.json(result.ok({ token }));
});
