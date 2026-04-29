/**
 * Graph invariants for ingestion fidelity (instance → graph).
 */

import type { SFGraph } from '../core/GraphSchema.js';
import type { SFNode } from '../types.js';

export function nodeIsBusinessRule(node: SFNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'BUSINESS_RULE') return true;
  return Array.isArray(node.secondaryTypes) && node.secondaryTypes.includes('BUSINESS_RULE');
}

export function nodeIsODataEntity(node: SFNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'ODATA_ENTITY') return true;
  return Array.isArray(node.secondaryTypes) && node.secondaryTypes.includes('ODATA_ENTITY');
}

export function nodeIsMdfObject(node: SFNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'MDF_OBJECT') return true;
  return Array.isArray(node.secondaryTypes) && node.secondaryTypes.includes('MDF_OBJECT');
}

export function nodeIsValidModifiesOrTriggerSource(node: SFNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'RBP_ROLE') return false;
  if (nodeIsBusinessRule(node)) return false;
  return true;
}

export function validateGraphIntegrity(graph: SFGraph): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set(graph.nodes.keys());

  let danglingGeneric = 0;
  for (const edge of graph.edges) {
    const fromOk = nodeIds.has(edge.from);
    const toOk = nodeIds.has(edge.to);
    if (!fromOk || !toOk) {
      const t = edge.type;
      if (t === 'MODIFIES' || t === 'TRIGGERED_BY' || t === 'ASSOCIATION') {
        errors.push(`${t}_dangling_endpoint:${edge.from}->${edge.to}`);
      } else {
        danglingGeneric += 1;
      }
    }
  }
  if (danglingGeneric > 0) {
    warnings.push(`edges_with_missing_endpoints:${danglingGeneric}`);
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;

    if (edge.type === 'MODIFIES' || edge.type === 'TRIGGERED_BY') {
      const source = graph.nodes.get(edge.from);
      if (!nodeIsValidModifiesOrTriggerSource(source)) {
        errors.push(`${edge.type}_invalid_source:${edge.from}->${edge.to}(type=${source?.type})`);
      }
      const target = graph.nodes.get(edge.to);
      if (!nodeIsBusinessRule(target)) {
        errors.push(`${edge.type}_target_not_rule:${edge.from}->${edge.to}(type=${target?.type})`);
      }
    }

    if (edge.type === 'ASSOCIATION') {
      const a = graph.nodes.get(edge.from);
      const b = graph.nodes.get(edge.to);
      if (nodeIsBusinessRule(a)) {
        errors.push(`ASSOCIATION_from_is_rule:${edge.from}->${edge.to}`);
      }
      if (nodeIsBusinessRule(b)) {
        errors.push(`ASSOCIATION_to_is_rule:${edge.from}->${edge.to}`);
      }
    }

    if (edge.type === 'EXPOSES') {
      const source = graph.nodes.get(edge.from);
      const target = graph.nodes.get(edge.to);
      if (!nodeIsODataEntity(source)) {
        errors.push(`EXPOSES_source_not_odata:${edge.from}(type=${source?.type})->${edge.to}`);
      }
      if (edge.from === edge.to) {
        errors.push(`EXPOSES_self_loop:${edge.from}`);
      }
      if (!nodeIsMdfObject(target)) {
        errors.push(`EXPOSES_target_not_mdf_object:${edge.from}->${edge.to}(type=${target?.type})`);
      }
    }
  }

  return { errors, warnings };
}
