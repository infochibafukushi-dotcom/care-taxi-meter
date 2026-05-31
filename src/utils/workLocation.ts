export type WorkLocation = {
  accuracy: number | null
  latitude: number | null
  longitude: number | null
}

export function captureWorkLocation(): Promise<WorkLocation> {
  if (!('geolocation' in navigator)) {
    return Promise.resolve({ accuracy: null, latitude: null, longitude: null })
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          accuracy: position.coords.accuracy,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      () => {
        resolve({ accuracy: null, latitude: null, longitude: null })
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
    )
  })
}
