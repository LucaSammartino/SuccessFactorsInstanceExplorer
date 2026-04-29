import type { EnrichedCompareResult, EnrichedNodeChange, EnrichedNodeRef } from './CompareEnricher.js';
import type { ObjectVerbAtom, FieldPermAtom, FieldOverrideAtom, SystemPermAtom } from './PermissionFlattener.js';

function escapeCsv(s: string | number | undefined | null): string {
  if (s == null) return '""';
  const str = String(s);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

export function formatCompareCsv(result: EnrichedCompareResult): string {
  const lines: string[] = [];
  lines.push('section,change_type,entity_kind,module_family,role_id,object_id,field_or_verb,previous_value,new_value,label,affects_count');

  const addLine = (row: (string | number | undefined | null)[]) => {
    lines.push(row.map(escapeCsv).join(','));
  };

  // 1. Nodes
  const processNode = (n: EnrichedNodeRef | EnrichedNodeChange, changeType: string) => {
    addLine(['node', changeType, n.type, n.moduleFamily || '', '', '', '', '', '', n.label, n.affectsCount]);
  };
  result.nodes.added.forEach(n => processNode(n, 'added'));
  result.nodes.removed.forEach(n => processNode(n, 'removed'));
  result.nodes.changed.forEach(n => processNode(n, 'changed'));

  // 2. Edges
  result.edges.added.forEach(e => addLine(['edge', 'added', e.type, '', '', '', '', '', '', e.id, '']));
  result.edges.removed.forEach(e => addLine(['edge', 'removed', e.type, '', '', '', '', '', '', e.id, '']));
  result.edges.changed.forEach(e => addLine(['edge', 'changed', e.type, '', '', '', '', '', '', e.id, '']));

  // 3. Permissions
  for (const [roleId, delta] of Object.entries(result.rolePermissionDeltas)) {
    const family = delta.moduleFamily || '';
    
    // objectVerbs
    delta.objectVerbs.added.forEach(a => addLine(['object_verb', 'added', '', family, a.roleId, a.objectId, a.verb, '', '', '', '']));
    delta.objectVerbs.removed.forEach(a => addLine(['object_verb', 'removed', '', family, a.roleId, a.objectId, a.verb, '', '', '', '']));
    
    // fieldPerms
    delta.fieldPerms.added.forEach(a => addLine(['field_perm', 'added', '', family, a.roleId, a.objectId, a.permission, '', '', '', '']));
    delta.fieldPerms.removed.forEach(a => addLine(['field_perm', 'removed', '', family, a.roleId, a.objectId, a.permission, '', '', '', '']));
    
    // systemPerms
    delta.systemPerms.added.forEach(a => addLine(['system_perm', 'added', '', family, a.roleId, '', a.permission, '', '', '', '']));
    delta.systemPerms.removed.forEach(a => addLine(['system_perm', 'removed', '', family, a.roleId, '', a.permission, '', '', '', '']));
    
    // fieldOverrides
    delta.fieldOverrides.added.forEach(a => addLine(['field_override', 'added', '', family, a.roleId, a.objectId, a.field, '', a.value, '', '']));
    delta.fieldOverrides.removed.forEach(a => addLine(['field_override', 'removed', '', family, a.roleId, a.objectId, a.field, a.value, '', '', '']));
    delta.fieldOverrides.changed.forEach(c => {
      const a = c.atom as FieldOverrideAtom;
      addLine(['field_override', 'changed', '', family, a.roleId, a.objectId, a.field, c.previousValue, a.value, '', '']);
    });
  }

  return lines.join('\n');
}

export function formatCompareMarkdown(result: EnrichedCompareResult): string {
  const lines: string[] = [];

  // 1. Header
  const baseGen = result.baseProject.generatedAt ? ` (Generated: ${result.baseProject.generatedAt})` : '';
  const targetGen = result.targetProject.generatedAt ? ` (Generated: ${result.targetProject.generatedAt})` : '';
  lines.push(`# Compare Report`);
  lines.push(`- **Base:** ${result.baseProject.name || result.baseProject.id}${baseGen}`);
  lines.push(`- **Target:** ${result.targetProject.name || result.targetProject.id}${targetGen}`);
  lines.push(`- **Total Changes:** ${result.totals.totalChanges}`);
  lines.push('');

  // 2. Summary
  lines.push('## Summary Totals');
  result.summaryLines.forEach(line => lines.push(`- ${line}`));
  lines.push('');

  // 3. Nodes by module family
  const families = new Set<string>();
  const nodesByFamily: Record<string, { added: EnrichedNodeRef[], removed: EnrichedNodeRef[], changed: EnrichedNodeChange[] }> = {};
  
  const addNodeToFamily = (n: any, bucket: 'added' | 'removed' | 'changed') => {
    const f = n.moduleFamily || '(unclassified)';
    families.add(f);
    if (!nodesByFamily[f]) nodesByFamily[f] = { added: [], removed: [], changed: [] };
    nodesByFamily[f][bucket].push(n);
  };

  result.nodes.added.forEach(n => addNodeToFamily(n, 'added'));
  result.nodes.removed.forEach(n => addNodeToFamily(n, 'removed'));
  result.nodes.changed.forEach(n => addNodeToFamily(n, 'changed'));

  const sortedFamilies = Array.from(families).sort();
  for (const family of sortedFamilies) {
    const fnodes = nodesByFamily[family];
    if (fnodes.added.length === 0 && fnodes.removed.length === 0 && fnodes.changed.length === 0) continue;
    
    lines.push(`## Module: ${family}`);
    
    if (fnodes.added.length > 0) {
      lines.push('### Added Nodes');
      fnodes.added.forEach(n => lines.push(`- \`${n.id}\` (${n.type}) — ${n.label} (affects: ${n.affectsCount})`));
      lines.push('');
    }
    if (fnodes.removed.length > 0) {
      lines.push('### Removed Nodes');
      fnodes.removed.forEach(n => lines.push(`- \`${n.id}\` (${n.type}) — ${n.label} (affects: ${n.affectsCount})`));
      lines.push('');
    }
    if (fnodes.changed.length > 0) {
      lines.push('### Changed Nodes');
      fnodes.changed.forEach(n => {
        let extra = '';
        if (n.mdfFieldDelta) {
          const d = n.mdfFieldDelta;
          const parts: string[] = [];
          if (d.added.length) parts.push(`+fields: ${d.added.join(', ')}`);
          if (d.removed.length) parts.push(`−fields: ${d.removed.join(', ')}`);
          if (d.changed.length) parts.push(`~fields: ${d.changed.join(', ')}`);
          if (parts.length) extra = ` | ${parts.join(' | ')}`;
        }
        lines.push(`- \`${n.id}\` (${n.type}) — ${n.label} (affects: ${n.affectsCount}) — keys: ${n.changedKeys.join(', ')}${extra}`);
      });
      lines.push('');
    }
  }

  // 4. Edges
  if (result.edges.added.length > 0 || result.edges.removed.length > 0 || result.edges.changed.length > 0) {
    lines.push('## Edges');
    if (result.edges.added.length > 0) {
      lines.push('### Added Edges');
      result.edges.added.forEach(e => lines.push(`- \`${e.id}\` (${e.type})`));
      lines.push('');
    }
    if (result.edges.removed.length > 0) {
      lines.push('### Removed Edges');
      result.edges.removed.forEach(e => lines.push(`- \`${e.id}\` (${e.type})`));
      lines.push('');
    }
    if (result.edges.changed.length > 0) {
      lines.push('### Changed Edges');
      result.edges.changed.forEach(e => lines.push(`- \`${e.id}\` (${e.type}) — keys: ${e.changedKeys.join(', ')}`));
      lines.push('');
    }
  }

  // 5. Role permission changes
  const formattedRoles = Object.values(result.rolePermissionDeltas).filter(r => r.totals.added > 0 || r.totals.removed > 0 || r.totals.changed > 0);
  if (formattedRoles.length > 0) {
    lines.push('## Role Permission Changes');
    lines.push('');
    
    formattedRoles.sort((a, b) => a.roleLabel.localeCompare(b.roleLabel)).forEach(role => {
      lines.push(`### Role: \`${role.roleId}\` — ${role.roleLabel}`);
      lines.push('');
      
      const formatAtoms = (title: string, added: any[], removed: any[], changed?: any[], stringifier?: (a: any) => string) => {
        if (added.length === 0 && removed.length === 0 && (!changed || changed.length === 0)) return;
        lines.push(`#### ${title}`);
        added.forEach(a => lines.push(`- + Added: ${stringifier ? stringifier(a) : JSON.stringify(a)}`));
        removed.forEach(a => lines.push(`- - Removed: ${stringifier ? stringifier(a) : JSON.stringify(a)}`));
        if (changed) {
          changed.forEach(c => lines.push(`- ~ Changed: ${stringifier ? stringifier(c) : JSON.stringify(c)}`));
        }
        lines.push('');
      };

      formatAtoms('Object Verbs', role.objectVerbs.added, role.objectVerbs.removed, undefined, 
        (a: ObjectVerbAtom) => `[${a.objectId}] ${a.verb}`);
        
      formatAtoms('Field Perms', role.fieldPerms.added, role.fieldPerms.removed, undefined, 
        (a: FieldPermAtom) => `[${a.objectId}] ${a.permission}`);
        
      formatAtoms('System Perms', role.systemPerms.added, role.systemPerms.removed, undefined, 
        (a: SystemPermAtom) => `${a.permission}`);

      formatAtoms('Field Overrides', role.fieldOverrides.added, role.fieldOverrides.removed, role.fieldOverrides.changed, 
        (a: any) => {
          if (a.changeKind) {
            const c = a as any;
            return `[${c.atom.objectId}] ${c.atom.field} ( ${c.previousValue} -> ${c.atom.value} )`;
          }
          const f = a as FieldOverrideAtom;
          return `[${f.objectId}] ${f.field} = ${f.value}`;
        });
    });
  }

  return lines.join('\n');
}
