import type { SFGraph } from './GraphSchema.js';
import type { BusinessRuleNode, MdfObjectNode, ODataEntityNode, RbpRoleNode, SFEdge, SFNode } from '../types.js';
import { compareUtf16 } from './deterministicSort.js';

/**
 * SuccessFactors Instance Explorer
 *
 * Produces architect-facing metrics from the unified graph.
 */
export class ArchitecturalStats {
  graph: SFGraph;

  constructor(graph: SFGraph) {
    this.graph = graph;
  }

  calculate() {
    const nodes = Array.from(this.graph.nodes.values());
    const edges = this.graph.getRenderableData().edges;

    const mdfObjects = nodes.filter((node): node is MdfObjectNode => node.type === 'MDF_OBJECT');
    const rules = nodes.filter((node): node is BusinessRuleNode => node.type === 'BUSINESS_RULE');
    const roles = nodes.filter((node): node is RbpRoleNode => node.type === 'RBP_ROLE');
    const odataEntities = nodes.filter((node): node is ODataEntityNode => node.type === 'ODATA_ENTITY');

    return {
      instanceOverview: this.instanceOverview(mdfObjects, rules, roles, odataEntities, edges),
      apiExposure: this.apiExposure(mdfObjects, odataEntities, edges),
      ruleCoverage: this.ruleCoverage(mdfObjects, rules, edges),
      associationAnalysis: this.associationAnalysis(mdfObjects, edges),
      moduleBreakdown: this.moduleBreakdown(nodes),
      fieldComposition: this.fieldComposition(mdfObjects),
      objectTaxonomy: this.objectTaxonomy(mdfObjects),
      dataModels: this.dataModelStats(),
      workflow: this.workflowStats()
    };
  }

  instanceOverview(
    mdfObjects: MdfObjectNode[],
    rules: BusinessRuleNode[],
    roles: RbpRoleNode[],
    odataEntities: ODataEntityNode[],
    edges: Array<SFEdge & { id: string }>
  ) {
    return {
      mdfObjects: mdfObjects.length,
      businessRules: rules.length,
      rbpRoles: roles.length,
      odataEntities: odataEntities.length,
      totalRelationships: edges.length
    };
  }

  apiExposure(
    mdfObjects: MdfObjectNode[],
    odataEntities: ODataEntityNode[],
    edges: Array<SFEdge & { id: string }>
  ) {
    const mdfIds = new Set(mdfObjects.map(node => node.id));
    const exposedIds = new Set<string>();

    edges
      .filter(edge => edge.type === 'EXPOSES')
      .forEach(edge => {
        if (mdfIds.has(edge.from)) exposedIds.add(edge.from);
        if (mdfIds.has(edge.to)) exposedIds.add(edge.to);
      });

    mdfObjects.forEach(objectNode => {
      if (objectNode.odataExposed) exposedIds.add(objectNode.id);
    });

    odataEntities.forEach(entityNode => {
      if (mdfIds.has(entityNode.id)) exposedIds.add(entityNode.id);
    });

    let creatableCount = 0;
    let updatableCount = 0;
    let deletableCount = 0;

    odataEntities.forEach(entityNode => {
      if (entityNode.creatable === 'true' || entityNode.creatable === true) creatableCount += 1;
      if (entityNode.updatable === 'true' || entityNode.updatable === true) updatableCount += 1;
      if (entityNode.deletable === 'true' || entityNode.deletable === true) deletableCount += 1;
    });

    return {
      totalMdfObjects: mdfObjects.length,
      totalODataEntities: odataEntities.length,
      exposedCount: exposedIds.size,
      coveragePct: mdfObjects.length > 0 ? Math.round((exposedIds.size / mdfObjects.length) * 100) : 0,
      crud: {
        creatable: creatableCount,
        updatable: updatableCount,
        deletable: deletableCount
      }
    };
  }

  ruleCoverage(
    mdfObjects: MdfObjectNode[],
    rules: BusinessRuleNode[],
    edges: Array<SFEdge & { id: string }>
  ) {
    const relevantEdges = edges.filter(edge => edge.type === 'TRIGGERED_BY' || edge.type === 'MODIFIES');
    const objectsWithRules = new Set<string>();
    const ruleCountByObject: Record<string, number> = {};

    relevantEdges.forEach(edge => {
      const fromNode = this.graph.nodes.get(edge.from);
      const toNode = this.graph.nodes.get(edge.to);

      let objectId: string | null = null;
      if (fromNode?.type === 'MDF_OBJECT') objectId = edge.from;
      if (toNode?.type === 'MDF_OBJECT') objectId = edge.to;
      if (!objectId) return;

      objectsWithRules.add(objectId);
      ruleCountByObject[objectId] = (ruleCountByObject[objectId] || 0) + 1;
    });

    const ruleHotspots = Object.entries(ruleCountByObject)
      .map(([id, count]) => ({
        id,
        label: this.graph.nodes.get(id)?.label || id,
        ruleCount: count
      }))
      .sort((left, right) => right.ruleCount - left.ruleCount || compareUtf16(left.id, right.id))
      .slice(0, 15);

    return {
      totalRules: rules.length,
      objectsWithRules: objectsWithRules.size,
      objectsWithoutRules: mdfObjects.length - objectsWithRules.size,
      coveragePct: mdfObjects.length > 0 ? Math.round((objectsWithRules.size / mdfObjects.length) * 100) : 0,
      ruleHotspots
    };
  }

  associationAnalysis(mdfObjects: MdfObjectNode[], edges: Array<SFEdge & { id: string }>) {
    const associations = edges.filter(edge => edge.type === 'ASSOCIATION');
    const connectionCount: Record<string, number> = {};

    associations.forEach(edge => {
      connectionCount[edge.from] = (connectionCount[edge.from] || 0) + 1;
      connectionCount[edge.to] = (connectionCount[edge.to] || 0) + 1;
    });

    const mdfIds = new Set(mdfObjects.map(node => node.id));
    const dependencyHubs = Object.entries(connectionCount)
      .filter(([id]) => mdfIds.has(id))
      .map(([id, count]) => ({
        id,
        label: this.graph.nodes.get(id)?.label || id,
        connectionCount: count
      }))
      .sort((left, right) => right.connectionCount - left.connectionCount || compareUtf16(left.id, right.id))
      .slice(0, 15);

    const connectedIds = new Set(Object.keys(connectionCount));
    const orphans = mdfObjects
      .filter(node => !connectedIds.has(node.id))
      .map(node => ({ id: node.id, label: node.label || node.id }))
      .sort((a, b) => compareUtf16(a.id, b.id));

    return {
      totalAssociations: associations.length,
      dependencyHubs,
      orphanCount: orphans.length,
      orphans: orphans.slice(0, 20)
    };
  }

  moduleBreakdown(nodes: SFNode[]) {
    const buckets = new Map<string, {
      family: string;
      nodeCount: number;
      objectCount: number;
      ruleCount: number;
      roleCount: number;
      odataCount: number;
      directCount: number;
      inferredCount: number;
      labelCounts: Record<string, number>;
    }>();
    const subBuckets = new Map<string, { family: string; subModule: string; nodeCount: number; objectCount: number; ruleCount: number; roleCount: number }>();
    const groupBuckets = new Map<string, { group: string; nodeCount: number; objectCount: number; ruleCount: number; familySet: Set<string> }>();

    for (const node of nodes) {
      const family = node.moduleFamily || 'Unclassified';
      const sub = node.subModule || 'General';
      const group = node.moduleGroup || 'Unclassified';

      if (!buckets.has(family)) {
        buckets.set(family, {
          family,
          nodeCount: 0,
          objectCount: 0,
          ruleCount: 0,
          roleCount: 0,
          odataCount: 0,
          directCount: 0,
          inferredCount: 0,
          labelCounts: {}
        });
      }

      const bucket = buckets.get(family)!;
      bucket.nodeCount += 1;
      bucket.labelCounts[node.moduleLabel || family] = (bucket.labelCounts[node.moduleLabel || family] || 0) + 1;
      if (node.type === 'MDF_OBJECT') bucket.objectCount += 1;
      if (node.type === 'BUSINESS_RULE') bucket.ruleCount += 1;
      if (node.type === 'RBP_ROLE') bucket.roleCount += 1;
      if (node.type === 'ODATA_ENTITY') bucket.odataCount += 1;
      if (node.moduleSource === 'direct') bucket.directCount += 1;
      else if (node.moduleSource && node.moduleSource !== 'default') bucket.inferredCount += 1;

      const subKey = `${family}|||${sub}`;
      if (!subBuckets.has(subKey)) {
        subBuckets.set(subKey, { family, subModule: sub, nodeCount: 0, objectCount: 0, ruleCount: 0, roleCount: 0 });
      }
      const sb = subBuckets.get(subKey)!;
      sb.nodeCount += 1;
      if (node.type === 'MDF_OBJECT') sb.objectCount += 1;
      if (node.type === 'BUSINESS_RULE') sb.ruleCount += 1;
      if (node.type === 'RBP_ROLE') sb.roleCount += 1;

      if (!groupBuckets.has(group)) {
        groupBuckets.set(group, { group, nodeCount: 0, objectCount: 0, ruleCount: 0, familySet: new Set<string>() });
      }
      const gb = groupBuckets.get(group)!;
      gb.nodeCount += 1;
      if (family !== 'Unclassified') gb.familySet.add(family);
      if (node.type === 'MDF_OBJECT') gb.objectCount += 1;
      if (node.type === 'BUSINESS_RULE') gb.ruleCount += 1;
    }

    const families = Array.from(buckets.values())
      .map(bucket => ({
        family: bucket.family,
        nodeCount: bucket.nodeCount,
        objectCount: bucket.objectCount,
        ruleCount: bucket.ruleCount,
        roleCount: bucket.roleCount,
        odataCount: bucket.odataCount,
        directCount: bucket.directCount,
        inferredCount: bucket.inferredCount,
        topLabels: Object.entries(bucket.labelCounts)
          .sort((left, right) => right[1] - left[1] || compareUtf16(left[0], right[0]))
          .slice(0, 3)
          .map(([label, count]) => ({ label, count }))
      }))
      .sort((left, right) => right.nodeCount - left.nodeCount || compareUtf16(left.family, right.family));

    const subModulesByFamily: Record<string, Array<{ subModule: string; nodeCount: number; objectCount: number; ruleCount: number; roleCount: number }>> = {};
    for (const sb of subBuckets.values()) {
      if (!subModulesByFamily[sb.family]) subModulesByFamily[sb.family] = [];
      subModulesByFamily[sb.family].push({
        subModule: sb.subModule,
        nodeCount: sb.nodeCount,
        objectCount: sb.objectCount,
        ruleCount: sb.ruleCount,
        roleCount: sb.roleCount
      });
    }
    for (const arr of Object.values(subModulesByFamily)) {
      arr.sort((a, b) => b.nodeCount - a.nodeCount || compareUtf16(a.subModule, b.subModule));
    }

    const moduleGroups = Array.from(groupBuckets.values())
      .map(gb => ({
        group: gb.group,
        nodeCount: gb.nodeCount,
        objectCount: gb.objectCount,
        ruleCount: gb.ruleCount,
        families: Array.from(gb.familySet).sort(compareUtf16)
      }))
      .sort((a, b) => b.nodeCount - a.nodeCount || compareUtf16(a.group, b.group));

    return {
      families,
      subModulesByFamily,
      moduleGroups,
      classifiedNodeCount: nodes.filter(node => (node.moduleFamily || 'Unclassified') !== 'Unclassified').length,
      unclassifiedNodeCount: nodes.filter(node => (node.moduleFamily || 'Unclassified') === 'Unclassified').length
    };
  }

  fieldComposition(mdfObjects: MdfObjectNode[]) {
    const typeDistribution: Record<string, number> = {};
    const visibilityDistribution: Record<string, number> = {};
    let totalFields = 0;

    mdfObjects.forEach(objectNode => {
      (objectNode.attributes || []).forEach(field => {
        totalFields += 1;
        const type = field.type || 'UNKNOWN';
        const visibility = field.visibility || 'UNKNOWN';
        typeDistribution[type] = (typeDistribution[type] || 0) + 1;
        visibilityDistribution[visibility] = (visibilityDistribution[visibility] || 0) + 1;
      });
    });

    const objectsByFieldCount = mdfObjects
      .map(objectNode => ({
        id: objectNode.id,
        label: objectNode.label || objectNode.id,
        fieldCount: (objectNode.attributes || []).length
      }))
      .filter(objectNode => objectNode.fieldCount > 0)
      .sort((left, right) => right.fieldCount - left.fieldCount || compareUtf16(left.id, right.id))
      .slice(0, 15);

    return {
      totalFields,
      typeDistribution,
      visibilityDistribution,
      objectsByFieldCount
    };
  }

  objectTaxonomy(objectNodes: MdfObjectNode[]) {
    const byClass: Record<string, number> = {};
    const byTechnology: Record<string, number> = {};
    const topCountryOverrideObjects: Array<{ id: string; label: string; countryCount: number; overrideFieldCount: number }> = [];
    const topCorporateModelObjects: Array<{ id: string; label: string; fieldCount: number }> = [];

    objectNodes.forEach(node => {
      const objectClass = node.objectClass || 'MDF';
      const technology = node.objectTechnology || 'MDF';
      byClass[objectClass] = (byClass[objectClass] || 0) + 1;
      byTechnology[technology] = (byTechnology[technology] || 0) + 1;

      if (node.countryOverrides?.length) {
        topCountryOverrideObjects.push({
          id: node.id,
          label: node.label || node.id,
          countryCount: node.countryOverrides.length,
          overrideFieldCount: node.countryOverrides.reduce((sum, entry) => sum + (entry.fieldCount || 0), 0)
        });
      }

      if (node.corporateDataModel?.fieldCount) {
        topCorporateModelObjects.push({
          id: node.id,
          label: node.label || node.id,
          fieldCount: node.corporateDataModel.fieldCount
        });
      }
    });

    return {
      byClass,
      byTechnology,
      topCountryOverrideObjects: topCountryOverrideObjects
        .sort(
          (left, right) =>
            right.countryCount - left.countryCount ||
            right.overrideFieldCount - left.overrideFieldCount ||
            compareUtf16(left.id, right.id)
        )
        .slice(0, 15),
      topCorporateModelObjects: topCorporateModelObjects
        .sort((left, right) => right.fieldCount - left.fieldCount || compareUtf16(left.id, right.id))
        .slice(0, 15)
    };
  }

  dataModelStats() {
    const dataModels = (this.graph.meta.dataModels || {}) as Record<string, any>;
    return {
      summary: dataModels.summary || {},
      sources: dataModels.sources || {},
      countries: dataModels.countries || [],
      ambiguousObjects: dataModels.ambiguousObjects || [],
      classificationPrecedence: dataModels.classificationPrecedence || []
    };
  }

  workflowStats() {
    const workflow = (this.graph.meta.workflow || {}) as Record<string, any>;
    return {
      summary: workflow.summary || {},
      stats: workflow.stats || {},
      diagnostics: workflow.diagnostics || {},
      topWorkflows: workflow.workflows?.slice(0, 15) || [],
      samples: workflow.samples || []
    };
  }
}
