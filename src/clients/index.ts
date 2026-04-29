import type { ClientProfile } from './ClientProfile.js';
import firstExample from './first-example.js';
import client2 from './client-2.js';

const REGISTRY: Record<string, ClientProfile> = {
  'first-example': firstExample,
  'client-2': client2
};

export function getClientProfile(slug: string | undefined): ClientProfile | null {
  if (!slug) return null;
  return REGISTRY[slug] ?? null;
}

export type { ClientProfile };
