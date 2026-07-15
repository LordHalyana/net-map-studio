import { threatIntelResponseSchema } from '@netplan/domain';
import type { EgressLookupRequest, EgressProvider, EgressProviderResult } from '../door.js';

/**
 * The M1 stub provider (plan §2 M1): declares itself egress-requiring so the
 * door's gate, disclosure and audit plumbing are exercised end to end, but
 * returns canned responses — no packet ever leaves. Online providers
 * (VirusTotal-style, self-hosted MISP) are seams; do not build them (plan §4).
 */
export const stubProvider: EgressProvider = {
  id: 'stub',
  version: '1.0.0',
  requiresEgress: true,
  execute(request: EgressLookupRequest): Promise<EgressProviderResult> {
    const response = threatIntelResponseSchema.parse({
      verdict: 'unknown',
      score: null,
      detail: 'stub provider — canned response',
    });
    return Promise.resolve({
      raw: JSON.stringify({
        provider: 'stub',
        indicatorType: request.indicatorType,
        indicator: request.query,
        ...response,
      }),
      response,
    });
  },
};
