export type ParsedVehicleSpeed = {
  pid: '0D'
  speedKmh: number
}

export type ParsedEngineRpm = {
  pid: '0C'
  rpm: number
}

const normalizeResponse = (response: string) => response.replace(/\r/g, ' ').replace(/\n/g, ' ').trim()

export function parseVehicleSpeed(response: string): ParsedVehicleSpeed | null {
  const match = normalizeResponse(response).match(/41\s*0D\s*([0-9A-F]{2})/i)
  if (!match) {
    return null
  }

  return {
    pid: '0D',
    speedKmh: parseInt(match[1], 16),
  }
}

export function parseEngineRpm(response: string): ParsedEngineRpm | null {
  const match = normalizeResponse(response).match(/41\s*0C\s*([0-9A-F]{2})\s*([0-9A-F]{2})/i)
  if (!match) {
    return null
  }

  const highByte = parseInt(match[1], 16)
  const lowByte = parseInt(match[2], 16)

  return {
    pid: '0C',
    rpm: ((highByte * 256) + lowByte) / 4,
  }
}
