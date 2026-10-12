import { describe, expect, it } from 'vitest'
import { cleanHost, inlineHosts, toolEmbedUrl, toolForUrl, TOOL_CATALOG } from '@/lib/lms/tools'

describe('toolForUrl', () => {
  it('finds catalog tools (sub-domains too) and their mode', () => {
    expect(toolForUrl('https://scratch.mit.edu/projects/10128407')).toMatchObject({ id: 'scratch', mode: 'INLINE' })
    expect(toolForUrl('https://www.tinkercad.com/things/abc')?.id).toBe('tinkercad')
    expect(toolForUrl('https://studio.code.org/s/x')).toMatchObject({ id: 'code-org', mode: 'NEW_TAB' })
  })
  it('refuses http, unknown sites and look-alike hosts', () => {
    expect(toolForUrl('http://scratch.mit.edu/projects/1')).toBeNull()
    expect(toolForUrl('https://evil.com/scratch.mit.edu')).toBeNull()
    expect(toolForUrl('https://scratch.mit.edu.evil.com/x')).toBeNull()
  })
  it('admin sites are allowed with their own mode', () => {
    const extra = [{ host: 'example-lab.org', nameEn: 'Lab', nameAr: '', mode: 'INLINE' as const }]
    expect(toolForUrl('https://sim.example-lab.org/a', extra)).toMatchObject({ id: 'site:example-lab.org', nameAr: 'Lab', mode: 'INLINE' })
    expect(inlineHosts(extra)).toContain('example-lab.org')
    expect(inlineHosts()).not.toContain('kahoot.it')
  })
})

describe('toolEmbedUrl', () => {
  it('turns project pages into the site player', () => {
    expect(toolEmbedUrl('https://scratch.mit.edu/projects/10128407/')).toBe('https://scratch.mit.edu/projects/10128407/embed')
    expect(toolEmbedUrl('https://www.tinkercad.com/things/aB3-x')).toBe('https://www.tinkercad.com/embed/aB3-x?editbtn=1')
    expect(toolEmbedUrl('https://wokwi.com/projects/322062421191557714')).toBe('https://wokwi.com/projects/322062421191557714?embed=1')
    expect(toolEmbedUrl('https://makecode.microbit.org/_abc123')).toBe('https://makecode.microbit.org/---run?id=_abc123')
    expect(toolEmbedUrl('https://www.geogebra.org/m/xyz12')).toBe('https://www.geogebra.org/material/iframe/id/xyz12')
    expect(toolEmbedUrl('https://codepen.io/me/pen/AbC')).toBe('https://codepen.io/me/embed/AbC?default-tab=result')
  })
  it('leaves other links as they are', () => {
    expect(toolEmbedUrl('https://phet.colorado.edu/sims/x.html')).toBe('https://phet.colorado.edu/sims/x.html')
  })
})

describe('cleanHost + catalog', () => {
  it('cleans admin input', () => {
    expect(cleanHost('https://www.Lab.example.org/page')).toBe('lab.example.org')
    expect(cleanHost('lab.org/x')).toBe('lab.org')
    expect(cleanHost('not a site')).toBeNull()
  })
  it('catalog ids are unique and every tool has a host', () => {
    expect(new Set(TOOL_CATALOG.map((t) => t.id)).size).toBe(TOOL_CATALOG.length)
    expect(TOOL_CATALOG.every((t) => t.hosts.length > 0)).toBe(true)
  })
})
