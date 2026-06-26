import { registerLayerType } from 'gladly-plot'
import { registerAxisQuantityKind } from 'gladly-plot'
import { hooks } from './hooks'

export function buildLayerTypeRegistry() {
  hooks.run.layer_types().forEach(({ name, layerClass }) =>
    registerLayerType(name, layerClass)
  )
}

export function buildQuantityKindRegistry() {
  hooks.run.quantity_kinds().forEach(({ name, descriptor }) =>
    registerAxisQuantityKind(name, descriptor)
  )
}
