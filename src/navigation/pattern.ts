export function decodeSearchPattern(address: string): string | undefined {
  if (address.length < 2 || (address[0] !== '/' && address[0] !== '?')) {
    return undefined;
  }
  const delimiter = address[0];
  if (address.at(-1) !== delimiter) {
    return undefined;
  }
  let body = address.slice(1, -1);
  if (body.startsWith('^')) {
    body = body.slice(1);
  }
  if (body.endsWith('$') && !body.endsWith('\\$')) {
    body = body.slice(0, -1);
  }
  return body.replace(/\\(.)/gs, '$1');
}
