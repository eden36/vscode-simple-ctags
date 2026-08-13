import * as path from 'node:path';
import * as vscode from 'vscode';
import type { NavigatorConfig } from './types';

const DEFAULT_NAMES = ['tags', '.tags'] as const;

export function readConfig(report: (message: string) => void): NavigatorConfig {
  const configuration = vscode.workspace.getConfiguration('ctagsNavigator');
  const enabled = configuration.get<boolean>('enabled', true);
  const rawNames = configuration.get<unknown>('tagFileNames', DEFAULT_NAMES);
  const rawMaxResults = configuration.get<unknown>('maxResults', 50);

  let tagFileNames: string[] = [];
  if (Array.isArray(rawNames)) {
    tagFileNames = rawNames.filter((value): value is string => {
      if (typeof value !== 'string' || !isSafeFileName(value)) {
        report(`配置 ctagsNavigator.tagFileNames 包含无效文件名，已忽略：${String(value)}`);
        return false;
      }
      return true;
    });
  }
  if (tagFileNames.length === 0) {
    report('配置 ctagsNavigator.tagFileNames 无有效值，已使用默认值 tags、.tags。');
    tagFileNames = [...DEFAULT_NAMES];
  }

  let maxResults = typeof rawMaxResults === 'number' && Number.isInteger(rawMaxResults)
    ? rawMaxResults
    : 50;
  if (maxResults < 1 || maxResults > 200) {
    report('配置 ctagsNavigator.maxResults 超出 1–200，已使用默认值 50。');
    maxResults = 50;
  }

  return { enabled, tagFileNames, maxResults };
}

function isSafeFileName(value: string): boolean {
  return value.length > 0
    && value !== '.'
    && value !== '..'
    && path.basename(value) === value
    && !value.includes('/')
    && !value.includes('\\');
}
