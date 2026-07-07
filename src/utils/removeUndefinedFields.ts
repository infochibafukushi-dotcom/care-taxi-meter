/**
 * Firestore rejects documents containing `undefined` values.
 * Recursively removes undefined keys from plain objects and arrays.
 */
export const removeUndefinedFields = <T>(value: T): T => {
  if (value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedFields(item))
      .filter((item) => item !== undefined) as T
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) {
      continue
    }
    result[key] = removeUndefinedFields(nested)
  }

  return result as T
}
