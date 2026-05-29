import QRCode from 'qrcode'

interface QrDisplayOptions {
  width: number
  margin: number
  dark: string
  light: string
}

const DEFAULT_OPTIONS: QrDisplayOptions = {
  width: 230,
  margin: 2,
  dark: '#111827',
  light: '#ffffff',
}

export async function createAuthorizeQrDataUrl(
  authorizeUrl: string,
  options: Partial<QrDisplayOptions> = {},
) {
  if (!authorizeUrl) {
    throw new Error('缺少授权地址，无法生成二维码')
  }

  const finalOptions = { ...DEFAULT_OPTIONS, ...options }
  return QRCode.toDataURL(authorizeUrl, {
    width: finalOptions.width,
    margin: finalOptions.margin,
    color: {
      dark: finalOptions.dark,
      light: finalOptions.light,
    },
  })
}

export async function createQrDisplayUrl(
  authorizeUrl: string,
  providerQrCodeUrl?: string | null,
  options: Partial<QrDisplayOptions> = {},
) {
  const providerImageUrl = providerQrCodeUrl?.trim()
  if (providerImageUrl && isDirectImageSource(providerImageUrl)) {
    return providerImageUrl
  }

  return createAuthorizeQrDataUrl(authorizeUrl, options)
}

function isDirectImageSource(value: string) {
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) {
    return true
  }

  const pathname = value.split(/[?#]/)[0]?.toLowerCase() ?? ''
  return /\.(png|jpe?g|gif|webp|svg)$/.test(pathname)
}
