import { Injectable } from '@nestjs/common';

/**
 * API metadata. The disclaimer is a safety-critical product rule: SENTRAVYN
 * is an information and preparedness platform, not an operational emergency
 * service (PRODUCT-SPEC.md 1, README.md "Important").
 */
@Injectable()
export class AppService {
  meta() {
    return {
      name: 'SENTRAVYN',
      version: 'api/v1',
      environment: 'information-and-preparedness',
      disclaimer:
        'SENTRAVYN is not a substitute for local emergency services, official warnings, ' +
        'professional medical care or government evacuation instructions.',
      safetyRules: [
        'A nearby place is not automatically a safe shelter.',
        'Emergency information is source-backed, timestamped and explicit about uncertainty.',
        'Stale data is visibly marked as stale, never presented as live.',
      ],
    };
  }
}
