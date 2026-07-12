import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sortRouteCandidatesById } from './services/preFixedRouteQuote'
import type { PreFixedRouteCandidate } from './types/preFixedMeterSession'

const sampleCandidate = (
  id: PreFixedRouteCandidate['id'],
  label: string,
): PreFixedRouteCandidate => ({
  id,
  label,
  distanceMeters: 3300,
  durationSeconds: 540,
  fixedFareYen: 1620,
  serviceFeesYen: 0,
  totalYen: 1620,
  tollIncluded: false,
  polyline: `polyline-${id}`,
})

describe('sortRouteCandidatesById', () => {
  it('orders candidates as A, B, C, D regardless of input order', () => {
    const sorted = sortRouteCandidatesById([
      sampleCandidate('D', '有料道路優先'),
      sampleCandidate('B', '一般道優先'),
      sampleCandidate('A', '時間優先'),
    ])

    expect(sorted.map((route) => route.id)).toEqual(['A', 'B', 'D'])
  })
})

describe('PreFixedRouteSelectionStep layout', () => {
  const componentSource = readFileSync(
    resolve(process.cwd(), 'src/components/preFixed/PreFixedRouteSelectionStep.tsx'),
    'utf8',
  )
  const cssSource = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8')

  it('renders candidate cards before the map', () => {
    const gridIndex = componentSource.indexOf('pre-fixed-route-candidate-grid')
    const mapIndex = componentSource.indexOf('<PreFixedRouteMapPanel')
    expect(gridIndex).toBeGreaterThan(-1)
    expect(mapIndex).toBeGreaterThan(gridIndex)
  })

  it('uses a 2-column candidate grid on mobile', () => {
    expect(componentSource).toContain('pre-fixed-route-candidate-grid')
    expect(cssSource).toContain('.pre-fixed-route-candidate-grid')
    expect(cssSource).toMatch(/\.pre-fixed-route-candidate-grid[\s\S]*grid-template-columns:\s*repeat\(2/)
  })

  it('shows selected badge and sticky footer area', () => {
    expect(componentSource).toContain('pre-fixed-route-card__selected-badge')
    expect(componentSource).toContain('pre-fixed-route-step-footer--sticky')
  })

  it('passes selected route polyline to the map panel', () => {
    expect(componentSource).toContain('showSelectedRouteOnly')
  })
})

describe('PreFixedRouteMapPanel route path handling', () => {
  const mapSource = readFileSync(
    resolve(process.cwd(), 'src/components/preFixed/PreFixedRouteMapPanel.tsx'),
    'utf8',
  )

  it('loads route legs / polyline path helpers and keeps S-G style markers', () => {
    expect(mapSource).toContain('pathFromRouteLegs')
    expect(mapSource).toContain('buildRouteMapMarkers')
    expect(mapSource).toContain("label: '発'")
    expect(mapSource).toContain("label: '着'")
  })
})
