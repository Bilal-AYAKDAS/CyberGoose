import type { ConnectionProfile } from '../types'

/** Sunucuları gruplarına ayırır; grupsuzlar en üstte, gruplar ada göre. */
export function groupServers(servers: ConnectionProfile[]) {
  const groups = new Map<string, ConnectionProfile[]>()
  for (const server of servers) {
    const key = server.group?.trim() ?? ''
    groups.set(key, [...(groups.get(key) ?? []), server])
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'tr')))
}
