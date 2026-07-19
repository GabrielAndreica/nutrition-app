export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'test') {
    return secret || 'test-secret';
  }

  if (!secret) {
    throw new Error('JWT_SECRET lipsește.');
  }

  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('JWT_SECRET trebuie să aibă minimum 32 de caractere în producție.');
  }

  return secret;
}
