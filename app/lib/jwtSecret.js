const DEFAULT_INSECURE_SECRET = 'your-secret-key-change-in-production';

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (process.env.NODE_ENV === 'test') {
    return secret || 'test-secret';
  }

  if (!secret || secret === DEFAULT_INSECURE_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET lipsește sau folosește valoarea implicită nesigură.');
    }

    return DEFAULT_INSECURE_SECRET;
  }

  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('JWT_SECRET trebuie să aibă minimum 32 de caractere în producție.');
  }

  return secret;
}
