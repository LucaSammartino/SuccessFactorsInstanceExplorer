export interface ClientProfile {
  slug: string;
  displayName: string;
  ruleBaseObjectOverrides?: Record<string, string>;
  moduleTaxonomyExtensions?: Record<string, string>;
  odataCountrySuffixes?: string[];
}
