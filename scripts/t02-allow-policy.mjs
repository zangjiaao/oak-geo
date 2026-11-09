// Specification test harness only. T05 must implement and test real server authorization.
// An allow row is conditional; this resolver never turns it into an unconditional 200.
import { readFileSync } from 'node:fs';
export const defaultRule = '# 未出现 (role, resource, operation) allow 行即 deny';
export function readAllowSet(path = 'docs/t02-permissions.csv') {
  const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
  if (lines.shift() !== defaultRule) throw new Error('Missing normative default-deny rule');
  if (lines.shift() !== 'role,resource,operation,effect,scope,basis,conditions') throw new Error('Invalid CSV header');
  const allows = new Map();
  for (const line of lines) {
    const [role, resource, operation, effect, scope, basis, conditions] = line.split(',');
    const key = [role, resource, operation].join(':');
    if (effect !== 'allow' || allows.has(key) || !conditions || !basis) throw new Error(`Invalid allow row: ${key}`);
    allows.set(key, { scope, basis, conditions });
  }
  return allows;
}
export function resolveSpecPermission(allows, { role, resource, operation }) {
  const row = allows.get([role, resource, operation].join(':'));
  return row ? { effect: 'conditional_allow', ...row } : { status: 403, error: { code: 'permission_denied' } };
}
