import { canonicalize } from 'json-canonicalize';
import { sha256 } from 'js-sha256';

export function canonicalJson(value: unknown): string {
  return canonicalize(value) ?? 'null';
}

export function sha256Canonical(value: unknown): string {
  return `sha256:${sha256(canonicalJson(value))}`;
}
