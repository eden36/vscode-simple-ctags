import type { TagRecord } from '../types';

const SCOPE_FIELDS = [
  'scope',
  'class',
  'struct',
  'namespace',
  'module',
  'package',
  'interface',
  'enum',
  'union',
  'trait'
] as const;

export function parseTagLine(line: string, bytePosition: number): TagRecord | undefined {
  if (line.startsWith('!_TAG_')) {
    return undefined;
  }
  const parts = line.split('\t');
  if (parts.length < 3 || parts[0].length === 0 || parts[1].length === 0) {
    return undefined;
  }

  const fields: Record<string, string> = {};
  let address = parts[2];
  if (address.endsWith(';"')) {
    address = address.slice(0, -2);
  }

  let kind: string | undefined;
  for (const part of parts.slice(3)) {
    const separator = part.indexOf(':');
    if (separator < 0) {
      if (!kind && part.length > 0) {
        kind = part;
      }
      continue;
    }
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key.length > 0) {
      fields[key] = unescapeField(value);
    }
  }

  const parsedLine = fields.line && /^\d+$/.test(fields.line)
    ? Number.parseInt(fields.line, 10)
    : undefined;
  const scope = SCOPE_FIELDS.map((field) => fields[field]).find(Boolean);

  return {
    name: parts[0],
    file: unescapeField(parts[1]),
    address,
    kind: fields.kind ?? kind,
    line: parsedLine && parsedLine > 0 ? parsedLine : undefined,
    scope,
    fields,
    bytePosition
  };
}

export function unescapeField(value: string): string {
  return value.replace(/\\(t|r|n|\\)/g, (_match, escaped: string) => {
    switch (escaped) {
      case 't': return '\t';
      case 'r': return '\r';
      case 'n': return '\n';
      default: return '\\';
    }
  });
}
