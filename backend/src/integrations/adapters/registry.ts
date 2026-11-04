import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  ProviderAdapter,
  ProviderKey,
  ProviderAdapterRegistry as ProviderAdapterRegistryContract,
} from '../types';
import { PROVIDER_ADAPTERS } from '../types';

/**
 * Concrete ProviderAdapterRegistry (the seam in integrations/types.ts).
 *
 * Each provider module registers its adapters under the multi-provider
 * token `PROVIDER_ADAPTERS`; Nest merges all of them into one array which
 * this constructor consumes. When no adapters are registered the registry
 * degrades to an empty one (get() returns undefined) rather than failing
 * bootstrap — the ingest service maps that to a FAILED ProviderFetch.
 *
 * The injected token is @Optional(): Nest passes `undefined` (not the TS
 * default) when no multi-provider entry exists, so the constructor guards
 * for a non-array instead of relying on the parameter default.
 */
@Injectable()
export class ProviderAdapterRegistry implements ProviderAdapterRegistryContract {
  private readonly byKey = new Map<ProviderKey, ProviderAdapter>();

  constructor(
    @Inject(PROVIDER_ADAPTERS)
    @Optional()
    adapters: ProviderAdapter[] | undefined = [],
  ) {
    const list = Array.isArray(adapters) ? adapters : [];
    for (const adapter of list) {
      this.byKey.set(adapter.key, adapter);
    }
  }

  get(key: ProviderKey): ProviderAdapter | undefined {
    return this.byKey.get(key);
  }

  keys(): ProviderKey[] {
    return [...this.byKey.keys()];
  }
}
