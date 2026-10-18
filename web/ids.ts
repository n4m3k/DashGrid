export function randomIdSuffix(length = 8): string {
  // Unlike randomUUID, getRandomValues is available on HTTP origins as well.
  const bytes = new Uint8Array(Math.ceil(length / 2));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}
