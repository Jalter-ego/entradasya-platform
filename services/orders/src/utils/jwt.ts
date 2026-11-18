import { readFileSync } from 'node:fs';
import { importSPKI, jwtVerify } from 'jose';
import { z } from 'zod';
import { config } from '../config/config.js';
import { JWT_ALGORITHM, ROLES } from '../constants/constants.js';
import type { VerifyToken } from '../types/auth.js';

const claimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum([ROLES.CUSTOMER, ROLES.ORGANIZER, ROLES.DOORMAN]),
  email: z.string().trim().toLowerCase().email().max(254),
});

function readPublicKey(): string {
  return config.jwt.publicKeyFile ? readFileSync(config.jwt.publicKeyFile, 'utf8') : config.jwt.publicKey;
}

/** Verifica localmente el JWT de auth (firma RS256, iss, aud, exp) sin consultar a auth. */
export async function createJwtVerifier(): Promise<VerifyToken> {
  const key = await importSPKI(readPublicKey(), JWT_ALGORITHM);
  return async (token) => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [JWT_ALGORITHM],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      requiredClaims: ['sub', 'role', 'email', 'exp'],
    });
    const claims = claimsSchema.parse(payload);
    return { id: claims.sub, role: claims.role, email: claims.email };
  };
}
