import type { CapturedAddressLocation } from './reverseGeocode'
import {
  REVIEW_DEMO_DESTINATION_ADDRESS,
  REVIEW_DEMO_DESTINATION_COORDINATES,
  REVIEW_DEMO_PICKUP_ADDRESS,
  REVIEW_DEMO_PICKUP_COORDINATES,
} from './reviewDemo'

const createFixedCapturedLocation = ({
  address,
  latitude,
  longitude,
}: {
  address: string
  latitude: number
  longitude: number
}): CapturedAddressLocation => ({
  address,
  capturedAt: new Date().toISOString(),
  latitude,
  longitude,
})

export const captureReviewDemoCurrentLocation = async (): Promise<CapturedAddressLocation> =>
  createFixedCapturedLocation({
    address: REVIEW_DEMO_PICKUP_ADDRESS,
    ...REVIEW_DEMO_PICKUP_COORDINATES,
  })

export const captureReviewDemoPickupLocation = async (): Promise<CapturedAddressLocation> =>
  createFixedCapturedLocation({
    address: REVIEW_DEMO_PICKUP_ADDRESS,
    ...REVIEW_DEMO_PICKUP_COORDINATES,
  })

export const captureReviewDemoDropoffLocation = async (): Promise<CapturedAddressLocation> =>
  createFixedCapturedLocation({
    address: REVIEW_DEMO_DESTINATION_ADDRESS,
    ...REVIEW_DEMO_DESTINATION_COORDINATES,
  })
