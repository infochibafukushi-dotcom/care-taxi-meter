declare module 'encoding-japanese' {
  type EncodingType = 'SJIS' | 'UNICODE' | 'UTF8' | string

  type ConvertOptions = {
    to: EncodingType
    from?: EncodingType
    type?: 'array' | 'string' | 'uint8'
  }

  const Encoding: {
    convert: (data: string | number[], options: ConvertOptions) => number[] | string | Uint8Array
  }

  export default Encoding
}
