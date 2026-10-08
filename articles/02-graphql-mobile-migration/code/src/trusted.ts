import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripIgnoredCharacters } from 'graphql';
import { createGraphQLError, type Plugin } from 'graphql-yoga';

/** Every operation one app version can ever send, keyed by its hash. */
export interface Manifest {
  client: string;
  version: string;
  operations: Record<string, string>;
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Whitespace and comments shouldn't change a document's identity. */
export const normalisedHash = (document: string) => sha256(stripIgnoredCharacters(document));

export class TrustedDocuments {
  private readonly byHash = new Map<string, string>();
  private readonly normalised = new Set<string>();

  constructor(readonly manifests: readonly Manifest[]) {
    for (const manifest of manifests) {
      for (const [hash, document] of Object.entries(manifest.operations)) {
        this.byHash.set(hash, document);
        this.normalised.add(normalisedHash(document));
      }
    }
  }

  static fromDirectory(dir: string): TrustedDocuments {
    const manifests = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Manifest);
    return new TrustedDocuments(manifests);
  }

  get(hash: string): string | undefined {
    return this.byHash.get(hash);
  }

  /** For old builds that send the full query text instead of a hash. */
  allowsRawDocument(document: string): boolean {
    return this.normalised.has(normalisedHash(document));
  }
}

export type TrustedMode = 'strict' | 'report';

/**
 * Trusted documents: the server only runs operations that shipped inside an
 * app build. Newer apps send a hash; old apps send the full text, which we
 * recognise by hashing it ourselves. In "report" mode unknown operations still
 * run but get logged, so you can switch it on before you trust your manifests.
 */
export function useTrustedDocuments(
  store: TrustedDocuments,
  mode: TrustedMode,
  onUnknown: (document: string) => void = () => {},
): Plugin {
  return {
    onParams({ params, setParams }) {
      const hash = persistedHash(params.extensions);
      if (hash) {
        const document = store.get(hash);
        if (!document) {
          throw createGraphQLError('PersistedQueryNotFound', {
            extensions: { code: 'PERSISTED_QUERY_NOT_FOUND', http: { status: 400 } },
          });
        }
        setParams({ ...params, query: document });
        return;
      }

      if (params.query && !store.allowsRawDocument(params.query)) {
        onUnknown(params.query);
        if (mode === 'strict') {
          throw createGraphQLError('This operation is not in any shipped app build', {
            extensions: { code: 'OPERATION_NOT_TRUSTED', http: { status: 400 } },
          });
        }
      }
    },
  };
}

function persistedHash(extensions: Record<string, unknown> | undefined): string | null {
  const persisted = extensions?.persistedQuery as { version?: number; sha256Hash?: unknown } | undefined;
  return persisted?.version === 1 && typeof persisted.sha256Hash === 'string' ? persisted.sha256Hash : null;
}
