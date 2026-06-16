import type { GpsLogEntry, GpsPosition } from '../types/case'
import { calculateDistanceMeters } from '../utils/distance'

export type SpeedSource = 'gps' | 'fallback' | 'obd' | 'unavailable'

export type SpeedReading = {
  speedKmh: number | null
  source: SpeedSource
}

export type VehicleSpeedProvider = {
  getSpeedReading(position: GpsPosition, previousLog?: GpsLogEntry): SpeedReading
}

export class GpsVehicleSpeedProvider implements VehicleSpeedProvider {
  getSpeedReading(position: GpsPosition, previousLog?: GpsLogEntry): SpeedReading {
    if (position.speed != null && Number.isFinite(position.speed)) {
      return {
        source: 'gps',
        speedKmh: Math.max(position.speed * 3.6, 0),
      }
    }

    if (!previousLog) {
      return {
        source: 'unavailable',
        speedKmh: null,
      }
    }

    const elapsedSeconds = (position.updatedAt - previousLog.capturedAt) / 1000

    if (elapsedSeconds <= 0) {
      return {
        source: 'unavailable',
        speedKmh: null,
      }
    }

    const distanceMeters = calculateDistanceMeters(previousLog, position)

    return {
      source: 'fallback',
      speedKmh: (distanceMeters / elapsedSeconds) * 3.6,
    }
  }
}

export class ObdVehicleSpeedProvider implements VehicleSpeedProvider {
  getSpeedReading(): SpeedReading {
    return {
      source: 'unavailable',
      speedKmh: null,
    }
  }
}

export const gpsVehicleSpeedProvider = new GpsVehicleSpeedProvider()
