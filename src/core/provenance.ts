/**
 * Provenance: who put an item where it is, and through which channel.
 *
 * Adapters fill what their harness records (plugin manifests, lock files); providers add
 * facts only they know (an organisation's installer). Everything here is read-only data.
 */

export type Channel =
  /** A user-owned config file: hand edits and the harness's own CLI are indistinguishable. */
  | 'manual'
  /** Shipped inside a harness plugin / extension bundle. */
  | 'harness-plugin'
  /** Installed by the open-source `skills` CLI (~/.agents/.skill-lock.json). */
  | 'skills-cli'
  /** Installed by `whatsloaded install`. */
  | 'whatsloaded'
  /** Enterprise / managed policy file. */
  | 'policy'
  /** Known only to a provider extension. */
  | 'external';

export interface SourceRef {
  type: 'github' | 'git' | 'local' | 'npm' | 'pypi' | 'oci' | 'mcp-registry' | 'marketplace' | 'url';
  /** Never contains credentials (userinfo is stripped). */
  url?: string;
  repo?: string;
  path?: string;
  ref?: string;
  commit?: string;
  id?: string;
  version?: string;
}

export interface OwnerClaim {
  /** Provider id that made the claim. */
  provider: string;
  /** Display label, e.g. "Acme Sync". */
  label: string;
  /** The owner may revert edits; mutating requires --force. */
  enforces: boolean;
  /** Shown as a warning when planning changes to the item. */
  note?: string;
}

export interface Provenance {
  channel: Channel;
  /** "Installed by" display text: 'you', 'Claude plugin', 'skills CLI', a provider label... */
  by: string;
  plugin?: { id: string; name: string; marketplace?: string; version?: string };
  source?: SourceRef;
  installedAt?: string;
  updatedAt?: string;
  owner?: OwnerClaim;
  /** Files the facts above were read from. */
  evidence: string[];
}

/** Strip `user:password@` from URLs before they are stored or displayed. */
export function stripUserinfo(url: string): string {
  return url.replace(/^([a-z][\w+.-]*:\/\/)[^/@\s]*@/i, '$1');
}
