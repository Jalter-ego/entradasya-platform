import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import { JWT_ALGORITHM, type loadConfig } from './config.js';
import type { User } from './users.js';

export function createTokenSigner({ privateKeyPem, issuer, audience, ttlSeconds }: ReturnType<typeof loadConfig>['jwt']) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error('Se requiere una clave privada RSA de al menos 2048 bits');
  }

  return (user: User) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ role: user.role, email: user.email })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(key);
  };
}
