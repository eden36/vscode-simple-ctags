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
  if (body.endsWith('$') && trailingBackslashCount(body.slice(0, -1)) % 2 === 0) {
    body = body.slice(0, -1);
  }
  return body.replace(/\\(.)/gs, '$1');
}

// 结尾反斜杠为偶数个时，末尾的 $ 才是行锚点而不是被转义的字面量。
function trailingBackslashCount(value: string): number {
  let count = 0;
  while (count < value.length && value[value.length - 1 - count] === '\\') {
    count += 1;
  }
  return count;
}
