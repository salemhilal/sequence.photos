/** Base64url (base64 with - and _, unpadded), as in OAuth's PKCE and the server's tokens. */

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The decoded bytes, as a string of one character each (as atob gives). Throws if it isn't base64url. */
export function decodeBase64Url(text: string): string {
  return atob(text.replace(/-/g, '+').replace(/_/g, '/'));
}
