import type { SFGraph } from './GraphSchema.js';
import type { ModuleCandidate, ModuleSource, SFNode } from '../types.js';

const PROPAGATION_EDGE_TYPES = new Set(['ASSOCIATION', 'EXPOSES', 'TRIGGERED_BY', 'MODIFIES']);

const SOURCE_PRIORITY: Record<ModuleSource, number> = {
  direct: 4,
  category: 3,
  heuristic: 2,
  propagated: 1,
  default: 0
};

const GENERIC_TAGS = new Set(['Recommended', 'Results List Not Supported']);

const MODULE_GROUP_MAP: Record<string, string> = {
  EC: 'Core HR & Payroll',
  ECP: 'Core HR & Payroll',
  RCM: 'Talent Acquisition',
  ONB: 'Talent Acquisition',
  'PM/GM': 'Talent Management',
  SD: 'Talent Management',
  LMS: 'Talent Management',
  COMP: 'Talent Management',
  JPB: 'Talent Management',
  PLT: 'Platform',
  STE: 'Platform',
  TIH: 'Analytics & Shared Services',
  WFA: 'Analytics & Shared Services'
};

type ModuleApplyPayload = ModuleCandidate & {
  moduleSource: ModuleSource;
  moduleConfidence: number;
  moduleEvidence: string[];
};

export class ModuleClassifier {
  private readonly graph: SFGraph;

  constructor(graph: SFGraph) {
    this.graph = graph;
  }

  run(): void {
    for (const node of this.graph.nodes.values()) {
      this.classifyFromDirectTags(node);
    }

    for (const node of this.graph.nodes.values()) {
      if (!node.moduleFamily || node.moduleFamily === 'Unclassified') {
        this.classifyFromCategories(node);
      }
    }

    for (const node of this.graph.nodes.values()) {
      if (!node.moduleFamily || node.moduleFamily === 'Unclassified') {
        this.classifyFromHeuristics(node);
      }
    }

    this.propagateAcrossGraph();

    for (const node of this.graph.nodes.values()) {
      this.finalizeNode(node);
    }

    for (const node of this.graph.nodes.values()) {
      this.classifySubModule(node);
    }

    for (const node of this.graph.nodes.values()) {
      node.searchText = this.buildSearchText(node);
    }
  }

  classifyFromDirectTags(node: SFNode): void {
    const tags = Array.isArray(node.tags) ? node.tags.filter(Boolean) : [];
    const candidates = tags
      .filter(tag => !GENERIC_TAGS.has(tag))
      .map(tag => this.mapTextToModule(tag))
      .filter((c): c is ModuleCandidate => Boolean(c))
      .sort(
        (left, right) => this.scoreDirectTag(right.moduleLabel) - this.scoreDirectTag(left.moduleLabel)
      );

    if (candidates.length === 0) return;

    this.applyModule(node, {
      ...candidates[0],
      moduleSource: 'direct',
      moduleConfidence: 1,
      moduleEvidence: tags
    });
  }

  classifyFromCategories(node: SFNode): void {
    const n = node as SFNode & {
      permissionCategory?: string;
      mdfPermissionCategories?: string[];
      systemPermissionCategories?: string[];
    };
    const categories = [
      n.permissionCategory,
      ...(n.mdfPermissionCategories || []),
      ...(n.systemPermissionCategories || [])
    ]
      .filter(Boolean)
      .map(value => `${value}`.replace(/_/g, ' '));

    const candidates = categories
      .map(text => this.mapTextToModule(text))
      .filter((c): c is ModuleCandidate => Boolean(c));

    if (candidates.length === 0) return;

    const dominant = this.pickDominantCandidate(candidates);
    if (!dominant) return;

    this.applyModule(node, {
      ...dominant,
      moduleSource: 'category',
      moduleConfidence: 0.85,
      moduleEvidence: categories
    });
  }

  classifyFromHeuristics(node: SFNode): void {
    const n = node as SFNode & {
      description?: string;
      baseObjectAlias?: string;
      baseObject?: string;
    };
    const haystack = [
      n.id,
      n.label,
      n.description,
      n.baseObjectAlias,
      n.baseObject,
      ...(n.tags || [])
    ]
      .filter(Boolean)
      .join(' ');

    const candidate = this.mapTextToModule(haystack);
    if (!candidate) return;

    this.applyModule(node, {
      ...candidate,
      moduleSource: 'heuristic',
      moduleConfidence: 0.7,
      moduleEvidence: [n.id, n.label].filter(Boolean) as string[]
    });
  }

  propagateAcrossGraph(): void {
    const adjacency = new Map<string, string[]>();
    const nodes = this.graph.nodes;

    for (const edge of this.graph.edges) {
      if (!PROPAGATION_EDGE_TYPES.has(edge.type)) continue;
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
      adjacency.get(edge.from)!.push(edge.to);
      adjacency.get(edge.to)!.push(edge.from);
    }

    for (const node of this.graph.nodes.values()) {
      if (node.moduleFamily && node.moduleFamily !== 'Unclassified') continue;

      const neighbors = adjacency.get(node.id) || [];
      const strongCandidates = neighbors
        .map(id => this.graph.nodes.get(id))
        .filter((c): c is SFNode => Boolean(c))
        .filter(candidate => candidate.moduleFamily && candidate.moduleFamily !== 'Unclassified')
        .filter(candidate => (candidate.moduleConfidence || 0) >= 0.8)
        .filter(candidate => ['direct', 'category', 'heuristic'].includes(candidate.moduleSource || ''));

      if (strongCandidates.length === 0) continue;

      const dominant = this.pickDominantCandidate(
        strongCandidates.map(candidate => ({
          moduleFamily: candidate.moduleFamily!,
          moduleLabel: candidate.moduleLabel!
        }))
      );

      if (!dominant) continue;

      this.applyModule(node, {
        ...dominant,
        moduleSource: 'propagated',
        moduleConfidence: 0.6,
        moduleEvidence: strongCandidates.slice(0, 5).map(candidate => candidate.id)
      });
    }
  }

  finalizeNode(node: SFNode): void {
    if (!node.moduleFamily) node.moduleFamily = 'Unclassified';
    if (!node.moduleLabel) node.moduleLabel = 'Unclassified';
    if (!node.moduleSource) node.moduleSource = 'default';
    if (node.moduleConfidence == null) node.moduleConfidence = 0;
  }

  buildSearchText(node: SFNode): string {
    const n = node as SFNode & {
      permissionCategory?: string;
      mdfPermissionCategories?: string[];
      systemPermissionCategories?: string[];
      description?: string;
      baseObjectAlias?: string;
      baseObject?: string;
      resolvedBaseObject?: string;
      unresolvedBaseObject?: string;
      targetPopulation?: string;
      grantedPopulation?: string;
      includeSelf?: string;
      accessUserStatus?: string;
      objectClass?: string;
      objectTechnology?: string;
      foundationFramework?: string;
      foundationGroup?: string;
      modifiesFields?: string[];
      corporateDataModel?: { fields?: Array<{ id: string; label: string; visibility?: string; type?: string }> };
      countryOverrides?: Array<{
        countryCode: string;
        fields?: Array<{ id: string; label: string; visibility?: string; type?: string }>;
      }>;
      attributes?: Array<{ name: string; type: string; visibility: string }>;
    };

    const corporateFields = (n.corporateDataModel?.fields || []).flatMap(field => [
      field.id,
      field.label,
      field.visibility,
      field.type
    ]);
    const countryFlat = (n.countryOverrides || []).flatMap(override => [
      override.countryCode,
      ...(override.fields || []).flatMap(field => [field.id, field.label, field.visibility, field.type])
    ]);
    const attributesFlat = (n.attributes || []).flatMap(attribute => [
      attribute.name,
      attribute.type,
      attribute.visibility
    ]);

    const parts: Array<string | undefined> = [
      n.id,
      n.label,
      n.description,
      n.moduleFamily,
      n.moduleLabel,
      n.subModule,
      n.moduleGroup,
      n.permissionCategory,
      n.baseObjectAlias,
      n.resolvedBaseObject,
      n.unresolvedBaseObject,
      n.targetPopulation,
      n.grantedPopulation,
      n.includeSelf,
      n.accessUserStatus,
      n.objectClass,
      n.objectTechnology,
      n.foundationFramework,
      n.foundationGroup,
      ...(n.tags || []),
      ...(n.secondaryTypes || []),
      ...(n.modifiesFields || []),
      ...(n.searchKeywords || []),
      ...(n.mdfPermissionCategories || []),
      ...(n.systemPermissionCategories || []),
      ...corporateFields,
      ...countryFlat,
      ...attributesFlat
    ];

    return parts.filter(Boolean).join(' | ');
  }

  scoreDirectTag(label: string | undefined): number {
    if (!label) return 0;
    if (label.includes(' - ')) return 3;
    if (label.includes('(')) return 2;
    return 1;
  }

  pickDominantCandidate(candidates: ModuleCandidate[]): ModuleCandidate | null {
    if (candidates.length === 0) return null;

    const buckets = new Map<string, number>();
    for (const candidate of candidates) {
      const key = `${candidate.moduleFamily}|||${candidate.moduleLabel}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    const sorted = Array.from(buckets.entries()).sort((left, right) => right[1] - left[1]);
    const winner = sorted[0];
    if (!winner) return null;

    const [moduleFamily, moduleLabel] = winner[0].split('|||');
    return { moduleFamily, moduleLabel };
  }

  applyModule(node: SFNode, candidate: ModuleApplyPayload): void {
    const currentPriority = SOURCE_PRIORITY[node.moduleSource || 'default'] ?? 0;
    const incomingPriority = SOURCE_PRIORITY[candidate.moduleSource] ?? 0;

    if (
      node.moduleFamily &&
      node.moduleFamily !== 'Unclassified' &&
      (incomingPriority < currentPriority ||
        (incomingPriority === currentPriority &&
          (candidate.moduleConfidence || 0) <= (node.moduleConfidence || 0)))
    ) {
      return;
    }

    node.moduleFamily = candidate.moduleFamily;
    node.moduleLabel = candidate.moduleLabel;
    node.moduleSource = candidate.moduleSource;
    node.moduleConfidence = candidate.moduleConfidence;
    node.moduleEvidence = candidate.moduleEvidence;
  }

  mapTextToModule(text: string | undefined): ModuleCandidate | null {
    const source = `${text || ''}`.trim();
    if (!source) return null;
    const normalized = source.toLowerCase();

    if (
      normalized.includes('foundation/platform') ||
      normalized.startsWith('plt -') ||
      normalized.includes('generic object') ||
      normalized.includes('role based permission') ||
      normalized.includes('permissions') ||
      normalized.includes('user management') ||
      normalized.includes('document') ||
      normalized.includes('email framework') ||
      normalized.includes('theme') ||
      normalized.includes('admin alert') ||
      normalized.includes('success store') ||
      normalized.includes('todo')
    ) {
      return this.module(
        'PLT',
        this.pickSpecificLabel(source, 'PLT - Generic Objects', [
          'Role Based Permissions',
          'User Management',
          'Document',
          'Email Framework',
          'Admin Alert',
          'Theme'
        ])
      );
    }

    if (
      normalized.includes('workforce analytics') ||
      normalized.startsWith('wfa') ||
      normalized.includes('report center') ||
      normalized.includes('people analytics') ||
      normalized.includes('story report') ||
      normalized.includes('canvas report') ||
      normalized.includes('ad hoc report')
    ) {
      return this.module('WFA', 'WFA - People Analytics');
    }

    if (
      normalized.includes('talent intelligence') ||
      normalized.startsWith('tih') ||
      normalized.includes('growth portfolio') ||
      normalized.includes('attributes library') ||
      normalized.includes('skill attribute')
    ) {
      return this.module('TIH', 'TIH - Talent Intelligence Hub');
    }

    if (
      normalized.includes('recruiting') ||
      normalized.startsWith('rcm -') ||
      normalized.includes('requisition') ||
      normalized.includes('candidate') ||
      normalized.includes('job application') ||
      normalized.includes('job posting') ||
      normalized.includes('offer') ||
      normalized.includes('crm')
    ) {
      return this.module(
        'RCM',
        this.pickSpecificLabel(source, 'RCM - Recruiting', [
          'Job Requisition',
          'Job Application',
          'Candidate',
          'Job Posting',
          'Offer'
        ])
      );
    }

    if (
      normalized.includes('succession and development') ||
      normalized.startsWith('sd -') ||
      normalized.includes('succession') ||
      normalized.includes('career and development') ||
      normalized.includes('calibration')
    ) {
      return this.module(
        'SD',
        this.pickSpecificLabel(source, 'SD - Succession Management', ['Calibration', 'Career', 'Development'])
      );
    }

    if (
      normalized.includes('job profile') ||
      normalized.startsWith('jpb') ||
      normalized.includes('job architecture') ||
      normalized.includes('competency library') ||
      normalized.includes('skill profile') ||
      normalized.includes('role definition')
    ) {
      return this.module('JPB', 'JPB - Job Architecture & Skills');
    }

    if (
      normalized.includes('performance and goals') ||
      normalized.includes('pm/gm') ||
      normalized.startsWith('pm -') ||
      normalized.startsWith('gm -') ||
      normalized.startsWith('mtr -') ||
      normalized.includes('goal management') ||
      normalized.includes('continuous performance management') ||
      normalized.includes('forms management') ||
      normalized.includes('multirater') ||
      normalized.includes('objective')
    ) {
      return this.module(
        'PM/GM',
        this.pickSpecificLabel(source, 'PM/GM - Goal Management', [
          'Goal Management',
          'Forms Management',
          'Continuous Performance Management',
          'MultiRater'
        ])
      );
    }

    if (
      normalized.includes('lms') ||
      normalized.includes(' learning') ||
      normalized.startsWith('learning') ||
      normalized.includes('course catalog') ||
      normalized.includes('curriculum') ||
      normalized.includes('training material') ||
      normalized.includes('digital certificate')
    ) {
      return this.module('LMS', 'LMS - Learning');
    }

    if (
      normalized.startsWith('comp -') ||
      normalized.includes('compensation management') ||
      normalized.includes('compensation statement') ||
      normalized.includes('merit matrix') ||
      normalized.includes('merit budget') ||
      normalized.includes('variable pay') ||
      normalized.includes('spot award') ||
      normalized.includes('milestone award') ||
      normalized.includes('salary planning') ||
      normalized.includes('comp plan')
    ) {
      return this.module('COMP', 'COMP - Compensation');
    }

    if (
      normalized.includes('onboarding') ||
      normalized.includes('offboarding') ||
      normalized.startsWith('onb') ||
      normalized.includes('onb2')
    ) {
      return this.module('ONB', 'ONB - Onboarding');
    }

    if (
      normalized.includes('suite') ||
      normalized.startsWith('ste -') ||
      normalized.includes('gdpr') ||
      normalized.includes('onbsimplify')
    ) {
      return this.module('STE', 'STE - Suite');
    }

    if (
      normalized.includes('payroll control center') ||
      normalized.includes('payroll control') ||
      normalized.startsWith('pcc') ||
      normalized.includes('ec payroll') ||
      normalized.includes('payroll replication') ||
      normalized.includes('payroll data maintenance')
    ) {
      return this.module('ECP', 'ECP - Employee Central Payroll');
    }

    if (
      normalized.includes('employee central') ||
      normalized.startsWith('ec -') ||
      normalized.includes('time off') ||
      normalized.includes('absence') ||
      normalized.includes('benefit') ||
      normalized.includes('payment') ||
      normalized.includes('payroll') ||
      normalized.includes('employment') ||
      normalized.includes('position') ||
      normalized.includes('workflow') ||
      normalized.includes('businessunit') ||
      normalized.includes('department') ||
      normalized.includes('division') ||
      normalized.includes('location') ||
      normalized.includes('jobinfo') ||
      normalized.includes('job info') ||
      normalized.includes('compensation information') ||
      normalized.includes('personal information') ||
      normalized.includes('employee profile') ||
      normalized.includes('foundation/organization') ||
      normalized.includes('holiday')
    ) {
      return this.module(
        'EC',
        this.pickSpecificLabel(source, 'EC - Employee Central', [
          'Time Off',
          'Benefit',
          'Payment',
          'Payroll',
          'Foundation',
          'Organization',
          'Position',
          'Personal Information',
          'Employee Profile',
          'Workflow'
        ])
      );
    }

    return null;
  }

  pickSpecificLabel(source: string, fallbackLabel: string, hints: string[]): string {
    const normalized = source.toLowerCase();

    if (hints.some(hint => normalized.includes(hint.toLowerCase()))) {
      for (const hint of hints) {
        if (normalized.includes(hint.toLowerCase())) {
          if (hint === 'Benefit') return 'EC - Global Benefits';
          if (hint === 'Time Off') return 'EC - Time Off';
          if (hint === 'Payment') return 'EC - Payment Information';
          if (hint === 'Payroll') return 'EC - Payroll';
          if (hint === 'Foundation' || hint === 'Organization' || hint === 'Position')
            return 'EC - Foundation/Organization';
          if (hint === 'Personal Information') return 'EC - Personal Information';
          if (hint === 'Employee Profile') return 'EC - Employee Profile';
          if (hint === 'Workflow') return 'EC - Workflow';
          if (hint === 'Role Based Permissions') return 'PLT - Role Based Permissions';
          if (hint === 'User Management') return 'PLT - User Management';
          if (hint === 'Document') return 'PLT - Document Management';
          if (hint === 'Email Framework') return 'PLT - Email Framework';
          if (hint === 'Admin Alert') return 'PLT - Admin Alerts';
          if (hint === 'Theme') return 'PLT - User Interface Themes';
          if (hint === 'Job Requisition') return 'RCM - Job Requisition';
          if (hint === 'Job Application') return 'RCM - Job Application';
          if (hint === 'Candidate') return 'RCM - Candidate';
          if (hint === 'Job Posting') return 'RCM - Job Posting';
          if (hint === 'Offer') return 'RCM - Offer';
          if (hint === 'Calibration') return 'SD - Calibration';
          if (hint === 'Career') return 'SD - Career and Development Planning';
          if (hint === 'Development') return 'SD - Career and Development Planning';
          if (hint === 'Goal Management') return 'PM/GM - Goal Management';
          if (hint === 'Forms Management') return 'PM - Forms Management';
          if (hint === 'Continuous Performance Management') return 'PM/GM - Continuous Performance Management';
          if (hint === 'MultiRater') return 'MTR - MultiRater Review';
        }
      }
    }

    return fallbackLabel;
  }

  module(moduleFamily: string, moduleLabel: string): ModuleCandidate {
    return { moduleFamily, moduleLabel };
  }

  classifySubModule(node: SFNode): void {
    const family = node.moduleFamily;
    node.moduleGroup =
      (family && MODULE_GROUP_MAP[family]) ?? (family === 'Unclassified' ? 'Unclassified' : 'Unknown');

    if (family === 'Unclassified') {
      node.subModule = 'Unclassified';
      return;
    }

    const n = node as SFNode & { description?: string; baseObjectAlias?: string; baseObject?: string };
    const haystack = [
      n.id,
      n.label,
      n.description,
      n.moduleLabel,
      n.baseObjectAlias,
      n.baseObject,
      ...(n.tags || [])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    node.subModule = this.mapToSubModule(family || '', node.moduleLabel || '', haystack);
  }

  mapToSubModule(family: string, moduleLabel: string, haystack: string): string {
    const lbl = moduleLabel.toLowerCase();

    switch (family) {
      case 'EC': {
        if (
          lbl.includes('time off') ||
          haystack.includes('time off') ||
          haystack.includes('leave') ||
          haystack.includes('absence') ||
          haystack.includes('holiday') ||
          haystack.includes('time account') ||
          haystack.includes('time tracking') ||
          haystack.includes('time sheet') ||
          haystack.includes('timesheet') ||
          haystack.includes('clock in')
        )
          return 'Time Management';
        if (lbl.includes('benefit') || haystack.includes('benefit') || haystack.includes('enrollment'))
          return 'Global Benefits';
        if (
          lbl.includes('payment') ||
          haystack.includes('payment') ||
          haystack.includes('bank') ||
          haystack.includes('direct deposit')
        )
          return 'Payment Information';
        if (lbl.includes('payroll') || haystack.includes('payroll')) return 'Payroll';
        if (
          haystack.includes('global assignment') ||
          haystack.includes('concurrent employment') ||
          haystack.includes('international assign')
        )
          return 'Global Assignments';
        if (haystack.includes('contingent') || haystack.includes('vendor') || haystack.includes('work order'))
          return 'Contingent Workforce';
        if (haystack.includes('advance') || haystack.includes('deduction')) return 'Advances & Deductions';
        if (
          haystack.includes('service center') ||
          haystack.includes('ticketing') ||
          haystack.includes('help desk')
        )
          return 'Employee Service Center';
        if (haystack.includes('public sector') || haystack.includes('cost assignment')) return 'Public Sector';
        if (haystack.includes('apprentice')) return 'Apprentice Management';
        if (haystack.includes('position') || lbl.includes('foundation') || lbl.includes('organization'))
          return 'Position Management';
        return 'Core HR';
      }
      case 'ECP': {
        if (haystack.includes('replication') || haystack.includes('data replication')) return 'Data Replication';
        return 'Payroll Control Center';
      }
      case 'RCM': {
        if (lbl.includes('job posting') || haystack.includes('job posting') || haystack.includes('posting'))
          return 'Recruiting Posting';
        if (
          haystack.includes('career site') ||
          haystack.includes('csb') ||
          haystack.includes('rmk') ||
          haystack.includes('marketing') ||
          haystack.includes('employer brand') ||
          haystack.includes('campaign')
        )
          return 'Recruiting Marketing';
        if (haystack.includes('interview') || haystack.includes('assessment')) return 'Interview Central';
        if (
          haystack.includes('crm') ||
          haystack.includes('talent pool') ||
          haystack.includes('candidate relationship')
        )
          return 'Candidate Relationship Management';
        return 'Recruiting Management';
      }
      case 'ONB': {
        if (
          haystack.includes('offboard') ||
          haystack.includes('departure') ||
          haystack.includes('exit interview')
        )
          return 'Offboarding';
        if (
          haystack.includes('crossboard') ||
          haystack.includes('internal hire') ||
          haystack.includes('internal transfer')
        )
          return 'Crossboarding';
        if (
          haystack.includes('compliance form') ||
          haystack.includes('i-9') ||
          haystack.includes('e-verify') ||
          haystack.includes('uscis')
        )
          return 'Compliance Forms';
        return 'Onboarding';
      }
      case 'PM/GM': {
        if (
          lbl.includes('continuous') ||
          haystack.includes('continuous performance') ||
          haystack.includes('cpm') ||
          haystack.includes('check-in') ||
          haystack.includes('check in') ||
          haystack.includes('achievement')
        )
          return 'Continuous Performance Management';
        if (
          lbl.includes('goal') ||
          lbl.startsWith('gm') ||
          haystack.includes('goal management') ||
          haystack.includes('objective') ||
          haystack.includes('cascade')
        )
          return 'Goal Management';
        if (
          lbl.includes('multirater') ||
          lbl.includes('mtr') ||
          haystack.includes('360') ||
          haystack.includes('multirater') ||
          haystack.includes('multi-rater')
        )
          return '360 Degree Reviews';
        if (haystack.includes('calibration') || lbl.includes('calibration')) return 'Calibration';
        return 'Performance Management';
      }
      case 'SD': {
        if (lbl.includes('calibration') || haystack.includes('calibration')) return 'Calibration';
        if (haystack.includes('mentor')) return 'Mentoring';
        if (
          lbl.includes('career') ||
          lbl.includes('development') ||
          haystack.includes('career') ||
          haystack.includes('cdp') ||
          haystack.includes('growth plan')
        )
          return 'Career Development Planning';
        return 'Succession Planning';
      }
      case 'LMS': {
        if (
          haystack.includes('compliance') ||
          haystack.includes('certification') ||
          haystack.includes('mandatory training') ||
          haystack.includes('signature')
        )
          return 'Compliance Management';
        return 'Content & Catalog Management';
      }
      case 'COMP': {
        if (haystack.includes('variable pay') || haystack.includes('incentive') || haystack.includes('bonus'))
          return 'Variable Pay';
        if (
          haystack.includes('recognition') ||
          haystack.includes('spot award') ||
          haystack.includes('milestone award')
        )
          return 'Reward & Recognition';
        return 'Compensation Management';
      }
      case 'JPB': {
        return 'Job Profile Builder';
      }
      case 'TIH': {
        if (haystack.includes('attribute') || haystack.includes('skill name')) return 'Attributes Library';
        return 'Growth Portfolio';
      }
      case 'WFA': {
        if (
          haystack.includes('report') ||
          haystack.includes('canvas') ||
          haystack.includes('story') ||
          haystack.includes('ad hoc')
        )
          return 'Report Center';
        return 'Workforce Analytics';
      }
      case 'PLT': {
        if (lbl.includes('role based') || haystack.includes('role based permission'))
          return 'Role Based Permissions';
        if (lbl.includes('user management') || haystack.includes('user management')) return 'User Management';
        if (lbl.includes('document') || haystack.includes('document management')) return 'Document Management';
        if (lbl.includes('email framework') || haystack.includes('email framework')) return 'Email Framework';
        if (lbl.includes('admin alert') || haystack.includes('admin alert')) return 'Admin Alerts';
        if (lbl.includes('theme') || haystack.includes('user interface theme')) return 'User Interface';
        if (
          haystack.includes('intelligent service') ||
          haystack.includes(' isc') ||
          haystack.includes('event publish')
        )
          return 'Intelligent Services Center';
        if (haystack.includes('opportunity marketplace') || haystack.includes('opportunity market'))
          return 'Opportunity Marketplace';
        if (haystack.includes('dynamic team') || haystack.includes('okr')) return 'Dynamic Teams';
        if (
          haystack.includes('metadata framework') ||
          haystack.includes('mdf') ||
          haystack.includes('generic object')
        )
          return 'Metadata Framework';
        return 'Foundation / Platform';
      }
      case 'STE': {
        if (haystack.includes('gdpr')) return 'GDPR Compliance';
        return 'Suite / Cross-Module';
      }
      default:
        return family;
    }
  }
}
