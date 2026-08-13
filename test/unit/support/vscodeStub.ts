import { createRequire } from 'node:module';
import * as posix from 'node:path/posix';

type ResolveFilename = (request: string, ...rest: unknown[]) => string;

// 单元测试在纯 Node 下运行，把 'vscode' 解析到本文件，使被测模块拿到下面的最小实现。
const nodeRequire = createRequire(__filename);
const internals = nodeRequire('node:module') as { _resolveFilename: ResolveFilename };
const originalResolveFilename = internals._resolveFilename;
internals._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]): string {
  return request === 'vscode' ? __filename : originalResolveFilename.call(this, request, ...rest);
};

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string
  ) {}

  public static file(value: string): Uri {
    const slashed = value.replace(/\\/g, '/');
    return new Uri('file', '', slashed.startsWith('/') ? slashed : `/${slashed}`);
  }

  public static from(parts: { scheme: string; authority?: string; path?: string }): Uri {
    return new Uri(parts.scheme, parts.authority ?? '', parts.path ?? '');
  }

  public static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, base.authority, posix.normalize(posix.join(base.path, ...segments)));
  }

  public get fsPath(): string {
    const withoutLeadingSlash = /^\/[A-Za-z]:/.test(this.path) ? this.path.slice(1) : this.path;
    return process.platform === 'win32' ? withoutLeadingSlash.replace(/\//g, '\\') : withoutLeadingSlash;
  }

  public toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export class Position {
  public constructor(public readonly line: number, public readonly character: number) {}

  public translate(lineDelta = 0, characterDelta = 0): Position {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }
}

export class Range {
  public constructor(public readonly start: Position, public readonly end: Position) {}
}

let configurationValues: Record<string, unknown> = {};

export function setConfigurationValues(values: Record<string, unknown>): void {
  configurationValues = values;
}

export const workspace = {
  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback: T): T {
        const value = configurationValues[`${section}.${key}`];
        return value === undefined ? fallback : (value as T);
      }
    };
  }
};

export const cancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} })
} as any;
