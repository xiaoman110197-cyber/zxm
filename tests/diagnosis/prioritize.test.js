import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFinding } from '../../src/diagnosis/prioritize.js';

test('direct data evidence can produce a confirmed fact', () => {
  const result = classifyFinding({
    kind: 'data_error',
    evidence: [
      { id: 'e1', strength: 'direct', source: 'workbook', deterministic: true }
    ],
    impact: 'high',
    action: '核对并修正汇总营业额',
    metric: '营业额一致性'
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.priority, 'P0');
  assert.ok(result.confidence >= 0.9);
});

test('multiple supporting signals with unresolved definition stay probable', () => {
  const result = classifyFinding({
    kind: 'business_issue',
    evidence: [
      { id: 'e1', strength: 'strong', source: 'owner_answer' },
      { id: 'e2', strength: 'strong', source: 'workbook' }
    ],
    unresolvedDefinition: true,
    impact: 'high',
    action: '确认客流口径并核对到店数据',
    metric: '实际到店人数'
  });
  assert.equal(result.status, 'probable');
  assert.equal(result.priority, 'P1');
  assert.ok(result.confidence < 0.9);
});

test('single weak signal remains a hypothesis', () => {
  const result = classifyFinding({
    kind: 'business_issue',
    evidence: [{ id: 'e1', strength: 'weak', source: 'owner_answer' }],
    impact: 'medium',
    action: '补充近30天订单数据',
    metric: '订单量'
  });
  assert.equal(result.status, 'hypothesis');
  assert.equal(result.priority, 'P2');
  assert.ok(result.confidence <= 0.5);
});

test('ordinary optimization cannot become P0 without severe deterministic risk', () => {
  const result = classifyFinding({
    kind: 'optimization',
    evidence: [{ id: 'e1', strength: 'direct', source: 'workbook', deterministic: true }],
    impact: 'high',
    action: '优化菜单结构',
    metric: '客单价'
  });
  assert.notEqual(result.priority, 'P0');
});

test('finding without evidence is rejected', () => {
  assert.throws(() => classifyFinding({
    kind: 'business_issue',
    evidence: [],
    impact: 'high',
    action: '检查',
    metric: '营业额'
  }), /evidence/);
});
