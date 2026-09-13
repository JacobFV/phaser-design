/**
 * Public surface of the computational layer. Algorithm modules import from here only, never from core/physics,
 * so the dependency direction stays algorithms → computation → physics.
 */
export * from './regions'
export type { AssetRef, MaskProgram, Vec2 } from '../physics/elements/types'
export type { GridSpec } from '../physics/field/grid'
