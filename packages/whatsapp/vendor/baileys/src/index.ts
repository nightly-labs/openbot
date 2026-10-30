import makeWASocket from './Socket/index'

export * from '../WAProto/index.js'
export * from './Utils/index'
export * from './Types/index'
export * from './Defaults/index'
export * from './WABinary/index'
export * from './WAM/index'
export * from './WAUSync/index'
// OPENBOT PATCH: the OpenBot Signal repository builds the LID mapping store itself.
export * from './Signal/lid-mapping'

export type WASocket = ReturnType<typeof makeWASocket>
export { makeWASocket }
export default makeWASocket
