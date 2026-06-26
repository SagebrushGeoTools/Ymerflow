import { hooks } from '../plugins/hooks'

let registry = null

export function buildDatasetRegistry() {
  registry = new Map(
    hooks.run.dataset_types().map(({ mimeType, cls }) => [mimeType, cls])
  )
}

export function getDatasetClass(mimeType) {
  return registry ? (registry.get(mimeType) || null) : null
}

export function createDatasetInstance(metadata) {
  if (!registry) throw new Error('Dataset registry not built yet — call buildDatasetRegistry() first')
  const Cls = registry.get(metadata.mime_type)
  if (!Cls) throw new Error(`Unknown dataset mime type: ${metadata.mime_type}`)
  return new Cls(metadata)
}
